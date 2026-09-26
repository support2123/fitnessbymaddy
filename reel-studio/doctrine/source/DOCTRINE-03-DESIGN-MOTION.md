# FBM REEL — DESIGN + MOTION SYSTEM (Pillar Spec for Arena)
**Format lock:** 9:16 · 1080×1920 · 30fps · deliver H.264 High, 10-bit grade → 8-bit out · audio 320kbps AAC 48kHz
**Non-negotiables:** English only · secular · the word "AI" never appears in any on-screen text · Maddy = he/him · NASM CPT credited on any on-camera lower-third.

---

## 1 · TYPOGRAPHY — LOCKED TYPE SYSTEM

### Role table (sizes = px cap-height at 1080 wide)

| Role | Font (licensable) | Size px | Weight | Case | Tracking | Fill |
|---|---|---|---|---|---|---|
| **DISPLAY** (hook / title / CTA headline) | **Druk Wide Bold** (Commercial Type) — fallback **Monument Extended Ultrabold** (Pangram Pangram), free fallback **Anton** | 130–180 | Bold/Super | ALL CAPS | −2% | Bone #F5F1E8 |
| **HEADLINE** (spoken-word kinetic captions) | **Anton** (Google, free — the burn-in workhorse) | 84–96 | 400 | ALL CAPS | 0 | White + 8px black stroke |
| **BIG-STAT NUMBER** (the punch) | **Druk Wide Bold**, OpenType `tnum` ON | 320–560 | Bold | — | −1% | Gold #D4A148 (payoff) / Bone (neutral) |
| **STAT UNIT / SUFFIX** (°, %, bpm, ml, yrs) | Druk Wide Bold or DM Sans Bold | 64–88 | Bold | UPPER | 0 | matches number, 70% opacity |
| **CITATION CHIP** | **Space Mono** (brand, free) `tnum` | 24–28 | 400 | UPPER | +6% | Cyan #38D8E0 on 12% white pill |
| **KICKER / LABEL** (chapter marker) | Space Mono | 28–34 | 700 | UPPER | +14% | Bone 65% |
| **LIVE-CLOCK TELEMETRY** (rolling digits) | Space Mono **or** JetBrains Mono, **tabular figures mandatory** | 44–72 | 400/700 | UPPER | +2% | Cyan (data) / Gold (on payoff) |
| **BODY / support** (rare) | DM Sans (brand) | 34–42 | 500 | Sentence | 0 | Bone 80% |

**Modular scale** (base 96, ratio 1.5): 28 · 42 · 64 · 96 · 144 · 216 · 324 · 486. Snap every size to this ladder — no in-between sizes.
**Hard rule: max 2 type sizes visible in any single frame.** A third element is a size-clash reject.

### Kinetic animation rules

**A big FIXED number "lands" (never count-up):**
- Enters fully-formed with an overshoot pop: scale `1.18 → 0.96 → 1.00` spring over **7 frames (233ms)**.
- Simultaneously: motion-blur/Gaussian `blur 3px → 0`, and `y +14px → 0`.
- On the settle frame: 1-frame white bloom flash at **6% opacity** + impact SFX (see §4).
- Digits use **tabular figures** so nothing reflows.

**Word reveal (spoken captions):**
- **Per-word, never per-letter** for sentences. Each word: bottom clip-mask reveal, `y +24px → 0`, `opacity 0→100`, `scale 0.94→1.0` over **3 frames (100ms)**, staggered to the voice onset.
- Emphasis word (action/anatomy/number): red #FF1F1F italic, `scale 1.06`, +2-frame hold. **Max one emphasis word per line.**

**NEVER:**
- No default cross-dissolve / fade-in-fade-out on type. Ever.
- **No count-up / odometer roll on a measured constant** (e.g. 37°C, 206 bones, 60% water) — animating a fixed fact fakes precision. It POPS in whole. Count-up is reserved *only* for the Living Clock (§2).
- No typewriter effect on full sentences. No letter-tracking animation on body. No center-and-fade. No smeary drop-shadows (use a crisp stroke + tight shadow y+6/blur14/α0.65).

---

## 2 · MOTION — MAKING A STILL BREATHE

### Still → alive (apply to every AI-generated frame)
1. **2.5D parallax** — cut the still into ≥3 planes (depth-pass displacement or masked subject). Background drifts opposite the push; subject plane moves **30–50% less** than background.
2. **Disciplined push-in** — `scale 1.00 → 1.06` across the *whole* chapter, constant/gentle velocity ≈ **0.5–1.0% per second**. Never exceed 8% (past that it reads as a zoom cheat). Anchor the push to the subject's eyeline/focal point, not frame center.
3. **Focus-pull** — once per chapter, on the reveal only: Gaussian `blur 0→12px` on the non-focal plane, `~10 frames`.
4. **Atmosphere layers** — real footage overlays (ProductionCrate / RocketStock dust, embers, god-rays), **Screen** blend, **8–15% opacity**, drifting 2–4px/s. Heat-shimmer on intensity beats.
5. **Micro-handheld** — ±2px positional noise at ~0.3Hz on the subject plane only. **Never shake text.**
6. **Anti-band grain** — fine 35mm grain 0.2–0.35 to kill gradient banding on the dark base.

### THE ONE LIVING CLOCK (episode signature)
One quantitative signal is the spine of the whole reel. It exists as **three synchronized layers driven by a single value curve**:
- **Environment reacts** — e.g. vignette/gold glow pulses on each heartbeat; frame brightness rises as hydration climbs.
- **Telemetry counter** (top-right HUD) — the live value in mono tabular figures.
- **Trace/graph** (bottom band) — a 2px line drawing its history left→right via stroke-dashoffset, glowing node at the head.

**Rules:**
- The clock is the **only** element permitted to count-up/roll — because it is genuinely accumulating.
- It **must land its final value on the exact frame the CTA card appears.** Author backwards: set CTA timecode `T_cta`, set final value `V_final`, time-map the value curve so `value(T_cta) = V_final`. Ease-out into the landing so the last digit clicks on the CTA impact.
- Every tick is **on-beat** (locked to music grid), with a heartbeat/tick SFX.

*Honest illustrative clocks (secular, science-true):* resting-HR trace dropping **72 → 58 bpm** across a cardio-adaptation story; a **12-week counter 0 → 12** as the protocol explains; sweat-loss **0 → 1200 ml** during a session breakdown. Never fabricate the number — the clock plots the same figure the citation supports.

### Transition grammar (between chapters)
- **Whip/motion-blur push**, 2–3 frames, direction consistent (always left, matching read order).
- **Match-cut on the clock pulse** (cut on a heartbeat) for chapter joins.
- **Light-wipe / lens-bloom** through a gold flare for the problem→solution turn.
- Speed-ramp *into* reveals (ramp down to ~40% just before the pop).
- **Banned:** hard cut with no motivated beat, canned slides, star-wipes, any preset transition.

### Pacing per second
- **0–2s hook:** one idea, biggest type, motion already moving, clock introduced ticking. 2–3 cuts inside first 3s.
- **Mid-reel:** beat/shot length **1.5–2.5s**; no static frame evolving less than every 2.5s.
- **Reveal every 4–6s.**
- **Ideal length 22–40s.** CTA occupies the last 2–3s as the clock lands.

---

## 3 · COLOR — DISCIPLINED PALETTE

| Token | Hex | Job | Rule |
|---|---|---|---|
| Graphite (base) | **#101115** | near-black blue background | the world |
| Mid neutral | #1B1E24 | gradient/step up | glue |
| Bone (light) | **#F5F1E8** | primary text/light | never pure #FFF |
| **Danger — red** | **#FF1F1F** | problem / "you're doing this wrong" / tension | **max 1 red element per frame** |
| **Resolve — gold** | **#D4A148** (light **#E8BC6A**) | solution, the clock, payoff, CTA | used **once** per frame as the hero |
| **Science — cyan** | **#38D8E0** | data, anatomy, telemetry, citations | the neutral clinical voice |

- **Red and gold are never co-equal in one frame** — tension and resolution are sequential (red chapters → gold payoff). Cyan may coexist with either, kept desaturated.

**Grading for "premium" (house = Editorial Athletic):**
- Grade in 10-bit. Neutralize every AI still to ~5600K first (they drift) so shots cut together.
- Lift shadows off pure black to **8–12 IRE** with a cool tint (#0E1116); crush, don't clip.
- Split-tone: shadows cool, highlights warmed toward gold (restrained teal-orange, not Instagram-loud).
- **Skin: luma 62–70 IRE, sat 45–55%, hue held 25–35° on vectorscope.**
- **Halation/bloom on gold highlights** so the hero color literally glows.
- Vignette **−0.10 to −0.15**. Grain 0.2–0.35 @ 35mm.
- LUT (Lutify "Clean Athletic" or custom PowerGrade) at **35–40% mix only — never 100%.**

---

## 4 · SOUND

- **Loudness target: −14 LUFS integrated · −1 dBTP.** Short-term should not exceed −9 LUFS.
- **Stems (4):** VO / Music / SFX / Ambience-bed. Ambience drone or room tone at **−30 dB** for glue.
- **Music:** Epidemic Sound / Musicbed, **instrumental only**. Pick tracks with a clear build+drop; land the reveal on the drop. BPM by format — Math 120–135 · Stop-Doing-X 110–125 · Verify 110–125 · Transformation 90–115.
- **Voice:** clean in iZotope RX (de-noise, de-plosive, de-ess) → HPF 80Hz → presence +3–5kHz → comp 3:1. VO sits **−16 to −14 LUFS**, always the top layer, always intelligible.
- **Sidechain duck — manual, no pumping:** draw volume automation on the music, **−6 to −7 dB under VO**, attack ~150ms / release ~400ms. Music returns to full only in VO gaps ≥0.5s. Do **not** use a live compressor sidechain (it breathes/pumps).
- **SFX:** impacts (sub-drop + transient) land **on the beat AND on every stat-pop**. A 2–4s **riser precedes every reveal**, cut hard at the impact. Directional whoosh on each chapter transition, matched to motion. Heartbeat/tick for the Living Clock (on-beat); subtle UI ticks (−24 dB) on counter rolls.
- **Silence as a weapon:** one beat of near-silence (music dropout) immediately before the biggest reveal.

---

## 5 · LAYOUT LAW — 9:16 (1080×1920)

**Occluded by Instagram UI (keep critical content OUT):**
- Bottom **~330px** (caption + audio + profile).
- Right rail icons: right **~130px** from ~y1150 downward.
- Top corners / profile row: **y0–220**.

**Action/title-safe core = x:90–990 (900 wide) · y:250–1590. Hard floor y=1610.** Optical center sits high at **~y860** (bottom is dead).

| Element | Position |
|---|---|
| **Kicker / chapter marker** | top-left, x=90, y=250 — `01 / THE PROBLEM` (Space Mono) |
| **Citation chip** | top band y=260–340 (x=90 left) *or* directly under the stat — pill, cyan mono. Never bottom zone |
| **Big stat / hero number** | upper-mid, centered, cap-height centered **~y760–860** (dominates the visible center) |
| **Headline / spoken caption** | centered, baseline **y=1080–1180**, inside 900-wide box (Maddy_v1 y=1100) |
| **Live-Clock HUD** (counter+gauge) | **top-right**, right-aligned to x=990, y=270–420 — above the icon rail |
| **Trace / graph band** | horizontal, x=90–990, **y=1440–1560** — above floor, above UI |
| **CTA card** | centered, headline y=800 · sub y=980 · action prompt y=1180 — all inside core, gold, **one action only** |
| **Lower-third** (on-camera Maddy) | x=90, y=1360–1480 — `MADDY` / `NASM CPT • Sports Nutrition` |

Right edge below y1150 must stay clear ≥130px. Nothing load-bearing below y1610.

---

## 6 · WORLD-CLASS BAR — PASS/FAIL

**Finished FRAME (any single frame):**
- [ ] One idea readable in <0.5s
- [ ] ≤2 type sizes · ≤1 red element · gold used exactly once
- [ ] Everything critical inside x90–990 / y250–1590; right rail clear
- [ ] Text legible over image (stroke or scrim; AA-large contrast)
- [ ] Subject has depth + motion — not a flat dead still
- [ ] Citation chip present whenever a claim/number is on screen
- [ ] Skin 62–70 IRE, shadows not clipped, gold highlights glow
- [ ] **No "AI" text · English only · secular · he/him**

**Finished REEL:**
- [ ] Hook lands <2s with motion + Living Clock introduced
- [ ] ONE Living Clock present, synced across environment + counter + trace, **lands final value exactly on the CTA frame**
- [ ] Every stat-pop has an on-beat impact; every reveal has a riser
- [ ] No default fades / canned transitions; transition grammar consistent
- [ ] **No count-up on a fixed constant** — roll only on the clock
- [ ] −14 LUFS / −1 dBTP; VO always intelligible; music ducked with no pumping
- [ ] Retention: no static beat >2.5s; a reveal every 4–6s
- [ ] CTA in safe zone, gold, single action, NASM CPT credited if on-camera
- [ ] Would Whoop / ESPN / Apple Keynote ship this frame? Any single **no → reject and rebuild.**

---

*Handoff note for the master spec:* this pillar assumes Arena keeps a locked project template carrying the type ladder, the 6-token palette, the Editorial Athletic grade, and a reusable Living-Clock component (value curve → 3 synced layers) so every episode inherits the system instead of rebuilding it.
