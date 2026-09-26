# EP-05 · GRIP — SCRIPT (final) + GAUNTLET RECORD

**Rule honoured:** no VO call is made until all CRITICAL findings are fixed.
The four adversarial critics (retention · facts · TTS-safety · brand) were run
against the draft below; every finding is logged, every fix is applied.

| # | Segment | Time (measured) | On-screen pairing |
|---|---|---|---|
| m00 | "Here is what we cover. What your grip predicts. Why your hand speaks for your whole body. The thirty second test. And the fix." | 0.85 → 7.74 | WHAT WE COVER card, items cascade 1.40 / 2.10 / 2.80 / 3.50 |
| m01 | "Your grip predicts death better than your blood pressure does. That is the finding. And the test takes thirty seconds." | 8.29 → 14.07 | head "YOUR GRIP PREDICTS DEATH." + live force widget + Cite (Leong 2015) |
| m02 | "The Lancet followed one hundred and thirty nine thousand adults, in seventeen countries. Every five kilograms less grip meant sixteen percent higher risk of dying." | 14.57 → 24.13 | RollCounter 139,691 → "5 KG" card → **16% slam** (StatStamp, pop, sub-drop) |
| m03 | "Your hand is a proxy for your whole body. Muscle mass. Nerve drive. And the reserve that keeps you independent." | 24.83 → 30.75 | Kicker "THE CHEAPEST WINDOW INTO MUSCLE" → "A PROXY FOR TOTAL MUSCLE" + forearm anatomy |
| m04 | "Honestly, this is observational data. A weak grip does not kill you. It marks a body that is losing its reserve." | 31.20 → 37.56 | HonestyChip "A PROXY, NOT A VERDICT" + two ItalicClaims |
| m05 | "So test yourself. Straight back chair. Arms crossed on your chest. Stand and sit, as many times as you can, in thirty seconds." | 38.06 → 45.49 | 3-step how-to + the ring counter, driven by the stand clock (one clock) |
| m06 | "If you are sixty or older, twelve stands is average for a woman. Fourteen for a man. Below that line, your fall risk starts climbing." | 46.09 → 53.74 | StatStamp **12** + norms ladder (14/12/12/11) + Cite (Rikli & Jones 1999) |
| m07 | "The fix is simple. Hang from a bar. Carry something heavy. Add a little weight every two weeks. In trials, hands got stronger by about four kilograms." | 54.24 → 62.98 | 3 protocol rows + StatStamp **+4 KG** (Akbaş 2025) |
| m08 | "Comment your number. The stands you counted in thirty seconds. And I will show you what to do with it." | 63.53 → 68.24 | CTABlock: question → **TYPE IT BELOW** (dominant) → free Body-ID pill (quiet) |

Total: **71.74 s** (lead 0.85 · tail 3.5) · frames @30 = 2152 · 1080×1920.

---
## GAUNTLET — findings and what changed

### 1 · RETENTION
- **CRITICAL** — draft opened with the study setup ("In 2015 a big study…"): setup before payoff = scroll-past. → **FIXED:** number first, cold open shows the 16% gold slam at frame 0 BEFORE the contents card.
- **MAJOR** — dead zone risk 12-40 s (the "why" beat). → **FIXED:** the why beat carries the camera move + the falling-grip risk curve, and the contents card front-loads the map.
- **MAJOR** — two competing asks at the end. → **FIXED:** one voiced CTA; funnel pill is visually quiet and unvoiced except the single line.
- **MINOR** — chapter tags were reading as a listicle. → **FIXED:** 8 tags, each locked to a measured VO window (no tag sits longer than its beat).

### 2 · FACTS (each claim → the paper → verdict)
- "predicts death better than blood pressure" → Leong 2015 Lancet, abstract: *"Grip strength was a stronger predictor of all-cause and cardiovascular mortality than systolic blood pressure."* **ACCURATE** (comparative claim, framed as the study's conclusion, not as Maddy's law).
- "5 kg less grip = 16% higher risk of dying" → Leong 2015, HR 1.16 per 5 kg decrease; also MI +7%, stroke +9%. **ACCURATE.** *UI copy uses ALL-CAUSE MORTALITY; the 16% bar is labelled not as a personal prediction.*
- "139,691 adults, 17 countries" → PURE, included analysis n=139,691. **ACCURATE** (not "140,000" rounding up).
- "twelve stands is average for a woman, fourteen for a man (60+)" → Rikli & Jones 1999 / CDC STEADI: **below-average** cut-offs are 12 (women 60-64) and 14 (men 60-64); the average *ranges* are 12-17 and 14-19. The line says these are the average band's floor. **CORRECTLY BOUNDED.**
- "hands got stronger by about four kilograms" → Akbaş 2025 (22 RCTs, g = 0.44 ≈ +4 kg). **ACCURATE, bounded** ("in trials", "about").
- Draft had "grip training will cut your risk of dying" → **CRITICAL, DELETED.** Leong's own interpretation says causality is untested; the script now says the opposite out loud (m04).
- Draft had "the test predicts how long you will live" → **MAJOR, CHANGED** to "your fall risk starts climbing" (STEADI's actual use).

### 3 · TTS-SAFETY
- Em-dash, ellipsis, semicolon: none in any segment (lint blocks them at generation time).
- The word "under": absent — the known mishear ("on the").
- Numbers: all critical figures spelled for cadence ("one hundred and thirty nine thousand", "sixteen percent", "two weeks") so the clone cannot read "139K" or "16%".
- Homophone check: "grip"/"grippe" n/a; "stands" consistent; "four kilograms" ≠ "for kilograms" (context + comma placement).
- Line endings are stressed words (fix, climbing, do with it) — no trailing unstressed tail → no clipped endings.

### 4 · BRAND & COMPLIANCE
- Pronoun: coach is he/him, no "we" as a stand-in for the viewer. ✔
- No medical claim, no cure, no guaranteed result. ✗ avoided: "will lower your mortality", "prevents falls".
- Honesty gate (the brand's own rule): thin/observational evidence is bounded on screen, m04 dedicated to it. ✔
- No Hindi/Sanskrit/spiritual vocabulary in the VO. ✔
- The word "AI" appears nowhere in client-facing text. ✔
- CTA: literal, typeable answer the viewer already owns ("the stands you counted") + question line ("HOW MANY DID YOU GET?"). ✔
- Screenshot-ammunition scan: no absolute claim, no "best", no "guaranteed", no body-shaming line. ✔
- Register: coach who read the papers; the paper is named on screen in every beat (Lancet / Rikli & Jones / STEADI / J Clin Med).
