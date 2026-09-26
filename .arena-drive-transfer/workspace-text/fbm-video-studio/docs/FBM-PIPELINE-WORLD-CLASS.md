# FBM REEL PIPELINE — WORLD-CLASS EDITION
### fitnessbymaddy.com · @fitnessbymaddy_ · DECODE series
*Yeh file = ek hi jagah poora system: research se publish tak, aur uske baad growth tak.*
*Base: 4 shipped episodes (STRENGTH · BREATH · CORE · ENDURANCE) ka sealed SOP + EP-05 GRIP me bane portable engine.*

---

# PART 0 · DO PATHS, EK GRAMMAR

| | **Production path** (original studio) | **Portable path** (is repo me, EP-05 ne banaya) |
|---|---|---|
| Film | Remotion + three.js (`src/fbm/…`) | `tools/engine/filmlib.py` — wahi kit, Pillow port |
| Machine | Mac + Node 20 + Chromium + `--gl=angle` | koi bhi CPU box: Python + Pillow + ffmpeg |
| VO | ElevenLabs clone (`gen_vo.py`) | wahi tool · offline ke liye `gen_vo_scratch.py` |
| Output | 1080×1920 · 30 fps · wahi layout law | ✔ bilkul same grammar |

**Rule:** kit components dono me identical hain (`Head · Cite · Chapter · Kicker · StatStamp · RollCounter · ItalicClaim · HonestyChip · CTABlock · CredThird · ContentsCard · coldOpen`). Ek baar seekha gaya lesson, har jagah enforce hota hai.

**Ek episode ek command me:**
```bash
zsh tools/engine/run_episode.sh episodes/<EP> episodes/<EP>/film_<ep>.py --scratch
# VO → gate → timeline → score → mix → film → mux → QC → publish
```

---

# PART 1 · THE 9 STRIKES (har strike = tool + rule + gate)

### STRIKE 1 · RESEARCH — *claim pehle, source ke saath*
- **Tool:** `workflows/research-gauntlet.js` — 6 parallel angles: anatomy · stakes · importance · mistakes · why-people-skip · history.
- **Rule:** har fact = author + year + journal + **hook score 1-10**. Number > adjective.
- **Gate:** `docs/RESEARCH-<EP>.md` → **Maddy approve kare, tabhi script.** Uske apne recordings me topic pe jo bola ho, wahi script ka spine.

### STRIKE 2 · SCRIPT — *adversarial QA, EK VO call se pehle*
- **Tool:** `workflows/script-gauntlet.js` — 4 critics: **retention · facts · TTS-safety · brand**.
- **Rule:** hook me NUMBER pehle, setup baad me. 2 signposts max. Ek fact ek hi baar. CTA me EK ask. Patli evidence bound karo ("a signal, not a promise").
- **Gate:** saare CRITICAL fix → phir TTS. (EP-05 me isi ne "grip training se death risk girega" wala causal overclaim pakad ke delete karwaya — Leong 2015 khud kehta hai causality untested hai.)

### STRIKE 3 · VOICE — *ek hi awaaz, hamesha*
- **Tool:** `gen_vo.py` (ElevenLabs clone: multilingual_v2 · style **0** · similarity **0.75** · stability 0.50-0.62/beat · speed 0.90-0.98/line) → NATSEG chain → trim.
- **Rule:** emotion sirf sentence craft + subtle settings se. Voice-splicing = instant AI-feel. Text me sirf periods/commas; **em-dash, ellipsis, semicolon banned** (audible artifacts); "under" banned (mishear = "on the").
- **Gate:** `verify_vo.py` — manifest-driven (koi p_<id>.wav missing = FAIL, silent skip nahi) + whisper **dual-model** word-overlap + **artifact scan** (>0.3 s orphan voiced energy = FAIL). Numbers wali lines aankh se padho.
- **Offline mode:** `gen_vo_scratch.py` (piper) — timeline/film/score banane ke liye. Delivery me hamesha clone.

### STRIKE 4 · TIMELINE — *audio lead karta hai, visuals follow*
- **Tool:** `assemble_vo.py` → `vo.wav` + `timeline.json` (`{"seg":{id:[start,end]},"total","frames"}`).
- **Rule:** gaps: beat-change 0.70-0.75 s · andar 0.30-0.45 s · hook ke baad 0.50-0.55 s. Film ke saare beat windows **measured** times se — andaaze se kabhi nahi.
- **Gate:** research film 65-120 s. Speech 110 s+ ho gaya to script trim karo, gaps nahi.

### STRIKE 5 · SCORE — *VO star hai, bed uske neeche*
- **Tool:** `bedlib.py` recipe (`episodes/<EP>/bed_<ep>.py`) jo `timeline.json` **padhti** hai → impacts apne aap beat boundaries pe girte hain. Phir `mix_master.py`: sidechain duck + **two-pass LINEAR loudnorm → −14.0 LUFS / −1.0 dBTP** (output me verify).
- **Rule:** impact story-beats pe (slam, reveal, protocol), riser reveal se 1.2-1.5 s pehle, ticks sirf counters ke neeche, heartbeat tension wale beats me.
- **EP-05 addition:** `stand_tick()` (chair-stand metronome) + `sub_drop()`. **ONE CLOCK:** jis beat ka living signal hai (breath rate, heart rate, stand tick), wahi ek phase-integrated clock 3D/organ + counter + trace + score — sabko chalata hai, aur uska final value CTA line pe land karta hai.

### STRIKE 6 · FILM — *design system, taste nahi*
- **Tool:** `filmlib.py` (portable) / `src/fbm/kit/FbmFilmKit.tsx` (production) + episode film module.
- **Layout law (todna mana hai):** headline bottom **400** · citation bottom **330** · chapter top **46** · credential top **250** (reserve zone x<650) · **bottom ~330 px aur top-left username zone khaali** (platform UI) · feed cover me bottom 300 px clean.
- **Colour story:** cool neutral base · **RED** sirf danger/myth-strike · **GOLD** resolve/hero/kicker · **CYAN** science accents.
- **Camera narrate kare:** har shot me ek move (push/pull/pan) — 70 s locked-off frontal = death. Cold open: frame 0 pe film ka best moment, title card kabhi pehle nahi.
- **Kit ke andar bhare hue lessons:**
  · `RollCounter` apne t0 se pehle **invisible** (premature "0" ek baar ship ho chuka hai)
  · `StatStamp` measured constants **full value pe land** karta hai, kabhi count-up nahi ("20 ms" on screen jabki VO "thirty" bole = bug class)
  · `ItalicClaim` apna scrim khud laata hai (bright frame pe claim illegible nahi hoti)
  · `CTABlock` me comment ask **visually dominate** karta hai, funnel pill quiet secondary + ek priming question line
  · `ContentsCard` 0-4 s "WHAT WE COVER", VO chapter list **bolta** hai aur rows uske spoken timestamps pe cascade karte hain; card TOP layer, uske dissolve tak hook overlays gated
  · A translucent **human body frame me hona hi chahiye** — akela organ/bone cold lagta hai (reject ho chuka hai)
- **Render rule:** grain wala film CRF 20-22 pe delivery-encode karo (CRF 17 = 100 MB+), aur **audio-only fix = REMUX** (`mux_av.py`), kabhi fresh render nahi. Design fix sirf us window ka re-render + **keyframe-aligned `-c copy` splice** (EP-05 me do baar kiya, dono baar ≤3 min me).

### STRIKE 7 · QC SWEEP — *har sheet AANKH se*
- **Tool:** `qc_sweep.py <final.mp4> <out/>` → decode check + specs + loudness + AI-marker scan + **timestamped contact sheets** (2.5 s, 10-up).
- **Rule:** har sheet dekho. Sync spot-check: bola hua number apne visual pe **±1 s** me. Marker scan me pre-publish `Lavf/libx264` expected hai (publish strip karta hai); asli FAIL = C2PA/XMP/SynthID/ElevenLabs class.

### STRIKE 8 · FRESH EYES — *builder biased hota hai*
- **Tool:** `workflows/fresh-eyes-audit.js` (independent creative-director + compliance auditor, scores /10, verdict line). Transcript: `make_transcript.py`.
- **Rule:** SHIP WITH TWEAKS aaye to tweaks **Maddy ko dikhao**, chhupao mat. Critical fix → re-render → re-sweep.
- **EP-05 audit:** `episodes/GRIP-01/FRESH-EYES-AUDIT.md` — 8.1/10, do critical/major fix ship se pehle, sync checks ±1 s me.

### STRIKE 9 · SHIP — *sterile file, loud cover, one ask*
- **Tool:** `publish_ig.py` (metadata + x264 SEI strip, sterile PASS zaroori, purana version archive — delete kabhi nahi) · `make_cover.py` (cover.png feed + cover-story.png) · `CAPTION.md` (story, never summary).
- **Rule:** comment trigger = **literal type-able answer** jo viewer ke paas pehle se hai ("4, 6 or 8", "your resting heart rate", "the stands you counted"). Ek hi voiced CTA. Caption me "AI" shabd kabhi nahi.

---

# PART 2 · GROWTH LAYER (film ke baad ka kaam)

### 2.1 Hook formulas (proven, use in rotation)
1. **Predictor flip:** "X predicts Y better than Z does." *(EP-05: grip > blood pressure)*
2. **Number-first shock:** "Ten and a half million." *(EP-04)*
3. **Failure reveal:** "Two kilograms. That is all it takes to buckle a spine." *(EP-03)*
4. **Myth strike:** "Your abs do not exist." *(EP-03's myth beat)*
5. **You-are-doing-it-wrong (soft):** "But almost everyone trains this wrong. Probably you too." *(EP-04)*
   *Rule: dunk kabhi nahi. Blame system pe, viewer pe nahi.*

### 2.2 Retention curve targets (30 fps, 1080×1920, 65-120 s)
| Window | Target | Metric |
|---|---|---|
| 0-3 s | motion payoff + claim | 3-sec hold ≥ **70 %** |
| 3-15 s | 2 naye information chunks | 15-sec hold ≥ **55 %** |
| 15-45 s | proof + honesty (screenshot-able) | mid hold ≥ **40 %** |
| 45-70 s | test/protocol (viewer ko kaam mile) | completion ≥ **25 %** |
| last 5 s | ONE ask, dominant | comments per 1k views ≥ **8** |
| **Loop** | end frame = start frame energy | re-watch spike at 0 s |

### 2.3 Comment engine (algorithm ka fuel)
- Trigger ek **number** ho jo viewer already own karta hai → type karna 3 keystroke ka kaam.
- Question line ask se pehle: "HOW MANY DID YOU GET?" → identity bait.
- Pinned comment turant (template `CAPTION.md` me) + 5 seed comments 20 min me spread.
- Reply rule: har number comment ka reply us number ko repeat kare + ek prescription line + re-test date. Koi outcome promise nahi.

### 2.4 Cover & caption system
- Cover = **imagery-led, human figure, masthead `DECODE · EP NN`, ek 2-4 word wordmark, ek hook line** — thumb-stopping 400 px test pe pass hona chahiye.
- Caption = story jo video me **nahi** dikhi (numbers, sources, ek personal line, ek CTA). Pehli 2 lines hi hook hain — unhe edit na karo.
- Sources line + verification-ledger line har caption me: **brand ka moat**.

### 2.5 Posting SOP
1. Sterile file + cover + caption ready → 2. Publish (best windows IST: 7-9 am, 8-11 pm) → 3. Pinned comment 10 s me → 4. Seed comments 20 min me → 5. First hour: sabhi number replies → 6. 24 h baad: top 3 comments ko Story pe (social proof loop) → 7. 72 h baad: metrics review (neeche).

### 2.6 30-day calendar (DECODE weekly + 2 supporting reels)
| Week | DECODE episode (main) | Supporting |
|---|---|---|
| 1 | EP-06 **SLEEP** (deep sleep vs muscle) | 2 shorts: "your numbers" replies, form fix |
| 2 | EP-07 **PROTEIN** (per meal, not per day) | 2 shorts: plant vs animal protein myth |
| 3 | EP-08 **WALKING** (zone 2 ka sasta version) | 2 shorts: 10k steps myth, NEAT |
| 4 | EP-09 **KNEE** (deep squat safety) | 2 shorts: pain vs damage, rehab basics |
*"One thing up" rule:* har naya episode pichhle se **ek** cheez me upar — EP-06 = real cloned VO + ending loop + you-vs-average bars.

### 2.7 KPI dashboard (har episode ke baad 5 min)
- Views 24 h / 7 d · 3-sec hold % · completion % · comments per 1k · saves per 1k · profile visits → scan starts → plan sales (₹1,499 / ₹5,999 / live).
- **Decision table:** hold < 60 % → hook badlo, film same rakh sakte ho (remux + naya cold open). Completion < 20 % → episode 15 s chhota. Comments < 5/1k → ask ko aur literal karo. Saves < 3/1k → protocol beat ko aur actionable karo.

---

# PART 3 · EPISODE CHECKLIST (print-and-run)
```
[ ]  1  research-gauntlet → RESEARCH-<EP>.md → Maddy YES
[ ]  2  script draft → script-gauntlet → CRITICALs fixed → SCRIPT-FINAL.md
[ ]  3  segments.json → gen_vo.py (clone) / gen_vo_scratch.py (offline) → verify_vo.py PASS
[ ]  4  assemble_vo.py → timeline.json → film ke beat windows = measured times
[ ]  5  bed_<ep>.py → mix_master.py → −14.0 LUFS / −1.0 dBTP verified
[ ]  6  film_<ep>.py: kit components + cold open + contents + camera moves + ONE clock
[ ]  7  render_film.py → mux_av.py → qc_sweep.py → HAR sheet dekhi + ±1 s sync checks
[ ]  8  fresh-eyes-audit → criticals fixed → surgical re-render + keyframe splice → re-sweep
[ ]  9  publish_ig.py sterile PASS → cover.py → CAPTION.md → pinned + seeds → KPI review 72 h
```

# PART 4 · OPERATIONS
- **Secrets:** `ELEVENLABS_API_KEY` (env ya `~/.fbm.env`) · `FBM_VOICE_ID` (env ya episode ka `voice.txt`, git-ignored). Code me kabhi nahi.
- **Fonts:** Google-Fonts OFL (Anton · Space Mono · Cormorant Garamond · DM Sans) — `bootstrap_env.sh` khud laata hai.
- **Machines:** `binpaths.py` ffmpeg/ffprobe khud dhoondta hai (env → tools/bin → static-ffmpeg → imageio → PATH). Mac paths hard-coded nahi.
- **Archives:** purane versions `_archive-<date>-…` — delete kabhi nahi (Vrat 6).
- **Har episode ke baad:** `docs/LESSONS-LOG.md` me ek entry (kya toota, kya fix hua, kya rule bana).

---

# PART 5 · THE DECODER OS LAYER (content system · 2026-09-24)
Ye pipeline ab akela film engine nahi — woh **THE DECODER OS** ke andar baithta hai. Poora content system repo me saved hai; yahan wiring:

### 5.1 · THE DECODE — har post ke 6 beats (content/shows.json)
`1 REFRAME HOOK (0–3 s) → 2 REAL SYSTEM (3–8 s) → 3 ONE DATUM + CITATION (8–15 s) → 4 MYTH IT KILLS (15–22 s) → 5 TRAIN-IT TURN (22–27 s) → 6 HANDOFF, one CTA (last 3 s)`
Film module me map: cold_open_t (Beat 1) · kicker/anatomy render (Beat 2) · StatStamp/RollCounter + Cite + Clock HUD (Beat 3) · myth_strike (Beat 4) · instruction rows (Beat 5) · cta_block (Beat 6). **Sign-off sadaa:** *"Read your clock. Then train it."*

### 5.2 · ONE CLOCK (visual signature ban gaya)
Har episode ka ek living rate: film ka `the_clock()` aur bed ka tick wahi function — picture aur score ek hi number pe. Clock HUD: Space Mono gold `#D4A148`, top-right. EP-05 ka stand-clock (0.86→0.72→0.62 s) reference hai.

### 5.3 · NAYE DOCS / FILES (sab saved, sab linked)
| File | Kya hai |
|---|---|
| `docs/DECODER-OS.md` | poora source system (2,617 lines — 9 dimensions + factory + 90-day rollout + critic appendix) |
| `docs/PLAYBOOK.md` | hooks · retention · formats · show bible · proof moat · caption/CTA |
| `docs/PIPELINE-OS.md` | 13-agent OS · 2 production lines · citation library · metrics · flywheel · org |
| `docs/CONTENT-ENGINE.md` | 150-topic system + 9 strikes + cadence floor + file map |
| `docs/ROADMAP-90-DAY.md` | W1–2 setup → W3–6 flagship → W7–12 scale + brand-safety checklist |
| `docs/CRITIC-BACKLOG.md` | dono adversarial reviews, 53 findings, status + fix location |
| `docs/ERRATA-AND-CONFLICTS.md` | jahan sources takrate hain — kya lock hua, kya pending |
| `docs/BRAND-GUARDRAILS.md` | screenshot-proof rulebook + 10-point pre-publish gate |
| `content/topics.json` + `topics.md` | 15 pillars / 150 topics (tagged SS/AB/SL · T1–T5 · →program) |
| `content/QUEUE.md` | kya next ship hoga (Wave 1 = launch slate, Wave 2 = critic gaps) |
| `content/hooks.json` · `shows.json` · `citation-library.json` · `funnel.json` · `critic-backlog.json` | machine-readable engines |
| `tools/engine/new_episode.py` | topic ID → poora episode scaffold (segments + film + bed + research brief) |
| `tools/engine/brand_gate.py` | pre-publish scanner: woo lexicon · elemental names on surface · citation presence · pronouns · price drift · hype verbs |

### 5.4 · BRAND LOCK (jo ab har episode pe lagti hai)
- Surface names same: **NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL** (element wale naam sirf internal).
- Har number `content/citation-library.json` ke `locked` entry se aayega — cite nahi to **cut**, soften nahi.
- Correlation hooks pe honesty chip zabardast hai (EP-05: *"A PROXY, NOT A VERDICT"*).
- Deal: **85% teach / 15% ask**, ek hi CTA (default Body-Scan), comment-keyword ladder (SCAN/BURN/CONDITION/FLUID/FRAME/FOCUS), Wall number = **revenue per 1,000 reach**.
- Publish se pehle: `python3 tools/engine/brand_gate.py episodes/<EP>` → PASS, phir sterile publish.

---
**Ek line me system:** *Research pehle, script adversarial, VO gated, timeline measured, score voice ke neeche, film ek clock pe, QC aankh se, audit bahar se, publish sterile — aur uske baad sirf data bolta hai.* Ab uske upar ek aur layer: **THE DECODER OS — 6-beat decode, 150 topics, ek citation spine, aur ek screenshot-proof brand.**
