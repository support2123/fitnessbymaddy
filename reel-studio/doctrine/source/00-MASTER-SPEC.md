# ARENA MASTER SPEC — the world-class upgrade
*Hand this whole `ARENA-UPGRADE/` folder to Arena and say: "Adopt this as the operating layer. It sits on top of your existing DECODER OS (PIPELINE-OS.md, CONTENT-ENGINE.md, PLAYBOOK.md, hooks.json, shows.json, citation-library.json, BRAND-GUARDRAILS.md). Where this spec and an old rule disagree, this spec wins."*

**This folder =**
- `00-MASTER-SPEC.md` — this file: the operating brain (input model, duration router, the mix, the upgraded pipeline, plug-in map, series-pull, config).
- `DOCTRINE-01-HOOK-SCRIPT.md` — the world-best hook + viral-script system (12 archetypes, 3 length tiers, 6/6 viral checklist, line-craft).
- `DOCTRINE-02-OPENING-IMAGE.md` — the mind-bending first-frame / cover doctrine (no black open, ever).
- `DOCTRINE-03-DESIGN-MOTION.md` — the world-top type / motion / color / sound / layout system.

---

## 0 · THE MISSION (one line)
Every reel must make a stranger stop, feel their body is at stake, understand it in one watch, and immediately want the next one. Bar = Whoop / ESPN / Apple Keynote. Any frame a peer could screenshot and mock = rebuild.

## 0.1 · WHAT CHANGED FROM THE CURRENT ARENA OUTPUT (the 5 upgrades)
1. **No black opens.** Every reel is born on a full-bleed psychological hero image (DOCTRINE-02). The old "WATER / WHAT WE COVER on near-black" card is dead. The first frame doubles as the Instagram cover.
2. **Variable length, Arena decides.** Not every reel is a 2-minute DECODE. Range **15s → 2min**; Arena picks the tier from the topic's depth + the operator's request (§2).
3. **Mix name vs tease.** The topic is not always announced up front. ~6 named : 4 teased per 10 reels (DOCTRINE-01 §1).
4. **Scripts + hooks levelled to world-best + highest-viral** (DOCTRINE-01) — every angle covered, mind-blown, zero hype, honest.
5. **Design/motion levelled to world-top** (DOCTRINE-03) — living motion, kinetic type, one living clock, premium grade, disciplined sound.

---

## 1 · THE INPUT MODEL — how the operator hands Arena a job
The operator gives a **REQUEST CARD**. That is all. Arena designs everything else (research, hook, script, hero image, motion, type, sound, cover, caption).

```
REQUEST CARD
  TOPIC:        <one line — the subject, e.g. "why cardio burns fat and adds years">
  DURATION:     <"auto"  |  15s  |  30s  |  45s  |  60s  |  90s  |  2min>
  TIP (optional): <any steer — a fact to lead with, an angle, a myth to kill, a mood>
```
- **DURATION = "auto"** → Arena picks the tier (§2) itself, biasing to the SHORTEST length that fully covers the topic (short = more reach).
- **TIP is optional and never mandatory.** If given, it is a steer, not a script.
- Arena confirms back in ONE line before building only if something is genuinely ambiguous (per the operator's format-confirm rule). Otherwise it builds.
- The operator's non-delegable YES stays: research spine, final script, publish (PIPELINE-OS §6). Everything else Arena owns.

## 2 · DURATION INTELLIGENCE — the router (15s → 2min)
Arena maps the request to a TIER (from DOCTRINE-01 §2). Depth of topic + requested duration pick the tier. Pacing scales with tier.

| Tier | Length | When | Structure | Cut length | Reveal every |
|---|---|---|---|---|---|
| **A** | 15–30s | one devastating idea / a single myth or stat | hook → proof → turn → payoff → CTA (no chapters) | 1.0–1.8s | 3–5s |
| **B** | 30–60s | a myth + its fix (3 angles) | hook → tax → system → turn → protocol → CTA (light cards) | 1.5–2.2s | 4–6s |
| **C** | 60–120s | full mechanism, multi-angle (the DECODE flagship) | hook → THE TAX → THE SYSTEM → THE LIE → THE RECEIPT → THE PROTOCOL → CTA | 1.5–2.5s within chapters | 5–8s |

**Router rules:**
- If DURATION is a number, fit the nearest tier; if the topic can't fill it, drop a tier rather than pad. **Never pad** — a tight 25s beats a bloated 70s.
- If "auto": one-idea topic → A; myth+fix → B; deep system/tentpole → C.
- The default bias for reach is **A/B (22–45s)**. Reserve C for genuinely deep topics and monthly tentpoles. This IS the "mix type" the operator asked for.
- Whatever the tier, the **Living Clock lands its final value on the CTA frame** (DOCTRINE-03 §2).

## 3 · THE MIX — name vs tease (standing rule)
Follow DOCTRINE-01 §1 "NAME vs TEASE." Update `hooks.json` to carry a `reveal: name|tease` field per hook and enforce the **~6:4 named:teased ratio across any rolling 10 reels**. Category must always be graspable by second 3; never withhold past that.

## 4 · THE UPGRADED PIPELINE (9 strikes → 10, with the HERO OPEN)
Keep the existing 9-strike DECODER OS flow. **Insert one new strike (HERO OPEN, 5.5) and upgrade the craft stages (Hook, Script, Film) plus the ship gates.** Plug-in map to Arena's real files on the right.

| Strike | Stage | Upgrade | Plug into |
|---|---|---|---|
| 1 | Research | unchanged (6-angle gauntlet, citation-first) | `research-gauntlet.js`, `citation-library.json` |
| 2 | **Hook** | replace with DOCTRINE-01 §1 (12 archetypes + name/tease) | `hooks.json` (add archetypes + `reveal` field) |
| 3 | **Script** | replace with DOCTRINE-01 §2–4 (tier router, angle grid, viral 6/6, line-craft) | `script-gauntlet.js`, `shows.json`, `SCRIPT-FINAL.md` |
| 4 | Voice | unchanged (cloned VO, lints, verify gate) | `gen_vo_lib.py`, `verify_vo.py` |
| 5 | Timeline | unchanged (word-level → one clock) | `assemble_vo.py` → `timeline.json` |
| **5.5** | **HERO OPEN (NEW)** | generate the full-bleed psychological hero image (DOCTRINE-02), lock it as cover, build the 1–2s living reveal. **No reel proceeds on a black open.** | new `hero_open.py` + `content/hero-concepts.json` |
| 6 | Score | unchanged + DOCTRINE-03 §4 sound rules | `bedlib.py`, `mix_master.py` |
| 7 | **Film** | apply DOCTRINE-03 (type ladder, kinetic rules, living motion, palette, layout law) | `filmlib.py`, `film_<ep>.py`, `render_film.py` |
| 8 | QC | unchanged + DOCTRINE-03 §6 world-class bar checklist | `qc_sweep.py` |
| 9 | Fresh-eyes | unchanged, **raise ship gate to ≥ 8.5** and add the DOCTRINE-03 §6 + DOCTRINE-01 §3 checklists to the audit | `fresh-eyes-audit.js` |
| 10 | Publish | unchanged + **manually set the locked hero still as the IG cover** (DOCTRINE-02 §4) | `publish_ig.py`, `make_cover.py` |

## 5 · SERIES-PULL — make them wait for the next one
- Every reel's LAST 2 seconds open a loop the next reel closes (DOCTRINE-01 §3 axis 6). CTA = one owned-number comment + one **series-loop line** ("next: the one nap length that helps").
- Keep the DECODE identity constant (PIPELINE-OS §7): DECODE · PROVE · TRAIN, 85% teach / 15% ask, attack claims not people, the body is the hero not Maddy.
- Consistent visual grammar (same type ladder, palette, living-clock language) so the feed is instantly recognisable as one show — recognition drives the "wait."
- Chain topics: end a reel on the question the next topic answers (the flywheel in PIPELINE-OS §5).

## 6 · STANDING NON-NEGOTIABLES (never break — these are the moat)
- **English only · secular · Maddy = he/him.** The word "AI" NEVER appears in any on-screen text, caption, cover, or file metadata.
- **Every statistic carries its citation on screen** (Author, Journal, Year). No cite → cut, never soften (`citation-library.json` rule).
- **Honest bounding out loud** where evidence is thin ("39 people. A signal, not a promise."). Verbs match confidence tier. This raises trust and is a save-trigger.
- **No medical promises, no guru tone, no hype words** (DOCTRINE-01 §4 ban list).
- **The gates are law:** verify_vo PASS · −14.0 LUFS / −1.0 dBTP · QC world-class-bar PASS · fresh-eyes ≥ 8.5 · sterile publish (zero tool/AI markers) · brand_gate PASS. Nothing ships that skips a gate.
- **Audio-only fix = remux, never a fresh render.**

## 7 · END-TO-END CONFIG (one-time setup Arena must do so every episode inherits the system)
Build a **locked project template** carrying:
1. **Type ladder + 6-token palette + Editorial Athletic grade** (DOCTRINE-03 §1,3) as reusable presets.
2. **Living-Clock component** (value curve → 3 synced layers: environment + counter + trace, lands on CTA) (DOCTRINE-03 §2).
3. **HERO-OPEN module** (`hero_open.py`): concept picker (DOCTRINE-02 §2) → image-gen prompt → upscale → img2video reveal → cover-still export + lock (DOCTRINE-02 §4).
4. **`content/hero-concepts.json`** — the 12 hero concepts + master prompt template, tagged to pillar/topic.
5. **`hooks.json` upgrade** — the 12 archetypes + `reveal: name|tease` + the 6:4 ratio guard.
6. **Duration router** — request-card intake → tier selection (§2).
7. **Layout-law safe zones** baked into the render template (bottom 330px + right 130px + top corners clear).
8. **Fresh-eyes audit** updated with the two new checklists (design world-class-bar + viral 6/6).
Once these exist, an episode = fill the REQUEST CARD → the system produces the rest at the locked bar.

## 8 · THE OPERATING LOOP (how Arena runs one request, start to finish)
1. Read REQUEST CARD → router picks TIER + name/tease (§2, §3).
2. Research gauntlet → citation-locked spine → operator YES.
3. Hook: pick archetype (DOCTRINE-01 §1), write ON-SCREEN + SPOKEN.
4. Script: tier beat-map + angle grid, pass the 6/6 viral checklist, line-craft clean (DOCTRINE-01).
5. Voice → verify gate → timeline (one clock).
6. **HERO OPEN**: choose concept (DOCTRINE-02), generate + upscale + living reveal, export & lock cover still.
7. Film: build over the hero + real footage/anatomy, apply the full design/motion system (DOCTRINE-03), Living Clock synced to land on CTA.
8. Score + mix (−14 LUFS, ducked, no pump).
9. QC world-class bar → Fresh-eyes ≥ 8.5 → fix criticals → re-render if visual, remux if audio-only.
10. Publish sterile + set locked hero as cover + caption (4-block) + pinned comment + series-loop line.

## 9 · THE ACCEPTANCE TEST (Arena self-checks before delivery)
- [ ] Opens on a living full-bleed hero image; first frame = the cover; no black card.
- [ ] Hook lands in <2s, category clear, gap open; name/tease correct for the slate.
- [ ] Length matches tier; no padding; Living Clock lands on the CTA.
- [ ] Every stat cited; thin evidence bounded out loud; zero hype words; no "AI" text.
- [ ] Design/motion passes DOCTRINE-03 §6; script passes DOCTRINE-01 §3 (6/6).
- [ ] Gates green (VO / −14 LUFS / QC / fresh-eyes ≥8.5 / sterile / brand).
- [ ] Ends on a series loop that makes them wait for the next one.
Any single NO → rebuild that piece, do not ship.
