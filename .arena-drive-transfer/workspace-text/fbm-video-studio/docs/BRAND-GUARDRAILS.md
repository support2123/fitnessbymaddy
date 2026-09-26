# FBM BRAND GUARDRAILS — the screenshot-proof rulebook
> Source: `docs/DECODER-OS.md` (§1 positioning · §8 moat · §9 brand-QA · Critic-1/Critic-2 fixes) + the shipped-episode lessons.
> **This file is law for every asset.** The automated gate: `python3 tools/engine/brand_gate.py <episode_dir|file>` — it must PASS before publish.

---

## 0 · THE ONE TEST EVERY FRAME MUST PASS
> **Freeze any frame.** Is there a claim on it? Then: is the source on it, is the number right, is there zero mystical word?
> If a frame fails, **the frame** does not ship — not the reel. *(Screenshot Test)*

---

## 1 · POSITIONING (what we are)
- **Category:** BODY LITERACY — not the fitness niche. *"The trainer who decodes the body and mind you actually live in — sourced, not sold."*
- **Promise:** *"Leave any Maddy post knowing your own body better than you did — and able to check every word he said."*
- **Three-word essence:** **DECODE · PROVE · TRAIN** (per-post QA beat: *Mechanism · Receipt · Result*).
- **The Enemy = THE CONFIDENT LIE** — a fitness "fact" with no source and no mechanism. Three faces: **bro-science · guru-woo · quick-fix culture**. We attack the *claim*, never a named person or community. Anti-guru is also anti-bully.
- **The three rings:** Core (skeptical buyers) · Buyers-in-motion (a named problem) · **Amplifiers (trainers, physios, doctors)**. Ring 3 is the unlock — content a professional can share without losing face.
- **Credential framing (Critic fix 3.1):** NASM-CPT is the reassurance badge for beginners; **for the peer/authority tier the on-screen citation IS the credential.** Never fabricate a credential.

## 2 · THE 10 VOICE LAWS
1. **Mechanism → number → source.** Every teaching beat: what's happening → the exact number with units → who proved it.
2. **Numbers wear units.** `~20 nm`, `12 breaths/min`, `~42 L`, `206 bones`. Never a naked number.
3. **Second person, direct.** "Your body", "you recycle".
4. **Short declaratives.** State it. Stop. Let the number land.
5. **The citation is a mic-drop, not a hedge.** Drop it *after* the claim.
6. **Anti-guru.** Maddy is never the hero of the sentence — the body is.
7. **No hype adjectives.** Ban insane / crazy / shredded / God-tier / secret.
8. **Attack claims, not people.**
9. **One idea per post.** Two mechanisms = two posts.
10. **End on a decision, not a beg.** Never "like and follow please".
- **+ Critic-added law 11 — "RANGE, NOT POINT" (2.4):** show effect sizes, ranges, responder variability (Hubal 2005: hypertrophy response ~0% to +60%). This is what separates a scientist from a guru.
- **HE/HIM, 100%. English only. Secular.** Tone dial: The Mechanism/MADE OF FIVE = calm, cinematic; STOP = sharp; RECEIPTS = warm, factual.

## 3 · FORBIDDEN LEXICON (zero tolerance on any client-facing frame, caption or VO)
`tattva · chakra · prana · aura · vibration · frequency (spiritual sense) · energy (as life-force) · cosmic · sacred · divine · alignment (spiritual) · balance your elements · dosha · healing energy · "the universe" · resonance · numerology · guru-vibe · any Sanskrit/Hindi/Devanagari on surface`

**Allowed reframes**
| Woo temptation | Secular replacement |
|---|---|
| "raise your energy" | "raise your work capacity / VO₂ / drive" |
| "balance your body" | "restore joint symmetry / autonomic recovery" |
| "cleanse / detox" | "your liver and kidneys already clear it — here's the data" |
| "mind-body connection" | "the stress axis — cortisol, HRV, sleep architecture" |
| "flow / alignment" | "movement mechanics / posture under load" |

**The One-Swap Test:** replace the metaphor word with the organ/system name. If meaning is unchanged → secular, keep it. If the metaphor was doing explanatory work → cut it.
**Placement rule:** poetry lives in the title card and transitions; the mechanism is 100 % anatomy + number + name. A metaphor appears **at most once** per piece, never inside a claim.

### 3.1 · SURFACE-NAMING POLICY (Critic-2 Tier-0 fix — locked)
The five labels **SPACE · AIR · FIRE · WATER · EARTH are INTERNAL taxonomy only.** They are the *pancha mahabhuta* and a misinformation-burned skeptic will screenshot them as woo — the exact thing this brand bans.
**On-surface names (locked): `NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL`** (alt: NERVE · LUNG · CELL · BLOOD · FRAME).
Shipped films already comply: EP-03 CORE, EP-04 ENDURANCE, EP-05 GRIP carry no elemental branding.

## 4 · THE NUMBERS REGISTRY (locked values — one number, used everywhere)
Full machine-readable spine: **`content/citation-library.json`** (50 locked claims). Non-negotiable locks:
| Claim | Locked value | Source |
|---|---|---|
| Synaptic cleft | **~20–40 nm** (say "about 20 nanometres") | Kandel |
| Resting breathing | **~12 / min** (clinical 12–20; we hold 12) | clinical |
| Blood-gas barrier | **~0.3 µm at its thinnest** — *the 0.6 µm figure is the thicker tissue side and is retired* | West |
| ATP turnover | **≈ bodyweight/day — an ESTIMATE** (say "recycled"; never a journal citation) | textbook |
| Total body water | **~60 % ≈ ~42 L / 70 kg**; brain **~73 %** | Buono & Kolkhorst; Gray's |
| Bones / calcium | **206**; **~99 %** of body calcium in bone+teeth | Gray's |
| Protein | **1.6–2.2 g/kg/day** (plateau above ~1.6) | Morton 2018; ISSN |
| Creatine | **3–5 g/day** monohydrate | Kreider 2017 (ISSN) |
| Testosterone, M vs F | **~10–15× higher in men** | endocrine ranges |
| Grip & mortality | **5 kg lower grip = 16 % higher all-cause risk**; grip *outperformed* systolic BP — **association, not causation; grip is a PROXY** | Leong 2015 (PURE, 139,691) |
| Chair-stand below-average cut-offs | men 60–64 **<14** · women 60–64 **<12** | Rikli & Jones 1999; CDC STEADI |
**One Reference Body:** 70 kg adult male unless female-specific → then **60 kg female** and state the difference (TBW ~50–55 % vs ~60 %; ~10–15× less testosterone). Never mix reference bodies inside one asset.
**Why this file exists:** credibility dies from internal contradiction faster than from being wrong. Two defensible numbers used inconsistently reads sloppy; **one number used everywhere reads authority.**

## 5 · CONFIDENCE TIERS (say the claim at its true strength)
- **Tier 1** — position stands / meta-analyses → state as fact. *"Protein above ~1.6 g/kg stops adding muscle (Morton 2018)."*
- **Tier 2** — single RCT / cohort → **"one study found…"**; name population + n on the card.
- **Tier 3** — mechanism / animal / textbook estimate → **"mechanistically / plausibly / an estimate"** (ATP ≈ bodyweight lives here).
- **Absolute verbs are banned on probabilistic claims:** no *guarantees · cures · detoxes · melts fat · resets your metabolism*.
- **Correlation ≠ causation (Critic fix 0.2):** mortality/longevity hooks (VO₂max, grip, sit-rise) are **observational associations**. Never imply "train grip → live longer". The honesty chip is not optional on these — EP-05 shipped with *"A PROXY, NOT A VERDICT"*.

## 6 · MEDICAL SCOPE GUARDRAIL (Critic-1 gap 8 — mandatory)
- Educational framing only. **Never** diagnose, never prescribe, never promise outcomes.
- Red-line topics (PCOS, menopause/HRT, RED-S, postpartum, depression, medication/GLP-1) require: (1) a "not medical advice" line in the caption, (2) a clinician hand-off line — *"bring this to your doctor; here's the paper to show them"*, (3) Tier-3 hedge verbs where the evidence is emergent.
- Before/after imagery: only with written consent, never lighting tricks, and always paired with **process proof** (adherence %, weeks, loads, check-in screen-shares) — the trust format for a misinformation-burned audience (Critic-1 gap 9).

## 7 · MYTH AUTOPSY — the 10 kills (+ graveyard)
| # | Myth | The kill-shot | Receipt |
|---|---|---|---|
| 1 | Crunches burn belly fat | 6 wks ab training → no measurable ab-fat change | Vispute 2011; Ramírez-Campillo 2013 |
| 2 | Lifting makes women bulky | ~10–15× less testosterone; hypertrophy is slow | ACSM; endocrine |
| 3 | Muscle turns into fat | different tissues — impossible | NSCA Essentials |
| 4 | The 30-min anabolic window | window is hours; daily protein dominates | Aragon & Schoenfeld 2013 |
| 5 | "Toning" is separate | tone = muscle + less fat; no separate mechanism | Schoenfeld |
| 6 | Sweat = fat burned | sweat is thermoregulation | ACSM |
| 7 | Fasted cardio burns more fat | calories equated → identical | Schoenfeld/Aragon 2014 |
| 8 | Squats wreck knees | load-managed squats improve knee health | Hartmann 2013 |
| 9 | Eating after 8 pm makes you fat | energy balance, not the clock | Hall/NIH |
| 10 | High reps tone / low reps bulk | similar hypertrophy across loads to failure | Schoenfeld 2017/2021 |
**Graveyard (rapid-fire):** protein damages healthy kidneys (no — Devries 2018) · DOMS = growth (no) · detox teas → liver already does it · fat burners (only creatine + protein strongly supported) · metabolism "damaged forever" (adapts; magnitude usually smaller than headlines — Fothergill 2016 + Trexler 2014).

## 8 · CONTRADICTION GATE (Critic fix 3.4 — new QC step)
Before publishing, ask: **does this contradict a prior post?** The known live pair: *"muscle burns only ~6 kcal/lb"* vs *"muscle is the organ of longevity"* → always reconcile in-frame: muscle matters for **function, glucose disposal, longevity and body composition — not for revving resting metabolism** (+5 lb muscle ≈ +30 kcal/day).

## 9 · ARTICLES OF OPERATION (how money stays honest)
- **85 % teach / 15 % ask.** The sell never outweighs the lesson.
- **No manufactured scarcity.** The only real cap is a human's Live calendar.
- **Conflict-of-interest transparency (Critic fix 3.3):** we sell programs — and the science stays honest by *cite-or-delete, public errata, no fake scarcity*. Say it out loud once a month.
- **Correction Culture:** publish the errata, reissue the corrected receipt. A **Credibility Ledger** highlight logs claims + sources + corrections.
- **Borrowed lines are attributed (Critic fix 3.2):** "muscle is the organ of longevity" → attribute (Dr. G. Lyon) or originate a new line. Never launder another educator's slogan into the Maddy voice.
- **Voice sourcing (Critic fix 3.6):** hero/authority assets use the cloned voice only. Scratch/free TTS is for internal drafts — never on a published authority asset.

## 10 · PRE-PUBLISH GATE — the 10-point final checklist
1. **Screenshot Test** — any frame mockable? fix it.
2. **Citation on screen** — every number/claim carries Author · Year · Source (Author + journal + year), held ≥2 s, legible at thumbnail size.
3. **Numbers wear units** and match the Numbers Registry + One Reference Body.
4. **Secular-not-woo** — One-Swap Test passed; zero Forbidden Lexicon; surface names NEURAL/RESPIRATORY/METABOLIC/FLUID/STRUCTURAL.
5. **"Mind" is science, not spirit** — cortisol/CAR, HRV, physiological sigh (Balban 2023), habits (Lally 2010), exercise & depression (Schuch 2016).
6. **HE/HIM 100 %**; NASM-CPT lower-third on talking-head content; peer tier leads with the citation.
7. **Confidence-tier honesty** — verbs match the tier; correlation never sold as causation.
8. **Attack claims, not people.**
9. **No fear-bait, no bait-and-switch, no fake scarcity**; 85/15 respected; CTA passes the sell-out test.
10. **End on a decision** (usually the Body-Scan) + public errata culture intact.
Automated companion: `tools/engine/brand_gate.py` (lexicon scan · HE/HIM · citation presence on every on-screen stat · price/claim drift vs citation-library & ERRATA).

---
### Where these rules live in the production chain
| Rule | Enforced by |
|---|---|
| Lexicon / woo / HE-HIM | `tools/engine/brand_gate.py` (pre-publish) |
| Citation on every stat | `Cite` chip mandatory in the film module + gate |
| Locked numbers | `content/citation-library.json` (status: locked) |
| Correlation vs causation | honesty chip requirement (see EP-05 `film_grip.py`) |
| Prices / offer names | `docs/ERRATA-AND-CONFLICTS.md` (resolve before any CTA ships) |
| Fresh-eyes audit | `workflows/fresh-eyes-audit.js` / `episodes/*/FRESH-EYES-AUDIT.md` |
