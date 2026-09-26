# CRITIC BACKLOG — what the two adversarial reviews found, and where each fix lives
> Source: `docs/DECODER-OS.md` → **Appendix · Critic Additions** (the two reviews the OS itself ships): *Completeness Review* (Critic 1 — 21 gaps) and *Elite-Coach / Evidence-Skeptic Review* (Critic 2 — 32 findings).
> Machine twin: `content/critic-backlog.json`. Status: **FIXED** = the fix exists as a written rule/library entry in this repo · **PARTIAL** = started · **OPEN** = to be built · **VERIFY** = check before the asset ships.

## The two verdicts (kept verbatim in the JSON)
- **Critic 1:** *"You built a magnificent credibility skin and a thin content body. Close #1–#7 (mind pillar, food, workout demos, the human, react/stitch, trending audio, search/YouTube) and you have a category-owning system."*
- **Critic 2:** *"Strong production/funnel architecture bolted onto a science layer that the exact skeptics it targets would screenshot and mock. The skeleton is top-1%; the evidence QA is not shippable as-is."*

---

## CRITIC 1 — completeness (the content body)
| # | Gap | Status | Fix lives in |
|---|---|---|---|
| 1 | **MIND pillar is decorative** — need ~25 psychology topics (binge/restrict, food guilt, all-or-nothing, gym anxiety, self-sabotage, quit-at-week-3, relapse) | PARTIAL | `content/topics.json` has Mental 9 + Habit 9 + Stress 9; the psychology-of-buying cluster still to author |
| 2 | **Zero practical food content** — show the plate, not just the science | OPEN | `content/QUEUE.md` (food track) |
| 3 | **No exercise-demo backbone** — add **THE REP** weekly show (demo + cued form + muscle-map + Save/Try) | OPEN | show bible extension; roadmap |
| 4 | **No human/founder pillar** — the person is the moat at 2 M | OPEN | roadmap W7–12 (vlog / client-journey doc series) |
| 5 | **No react/stitch** — SECOND OPINION / CAUGHT | PARTIAL | show #7 exists; stitch mechanics to script |
| 6 | **No trending audio** — a distribution lever deliberately removed | OPEN | Maddy's call; engine films keep instrumental |
| 7 | **No search/YouTube-native evergreen engine** | PARTIAL | MADE OF FIVE long-form is the base; titles/metadata plan to build |
| 8 | **No medical scope-of-practice guardrail** | **FIXED** | `BRAND-GUARDRAILS.md` §6 |
| 9 | **Before/afters are least screenshot-proof** → process-proof | **FIXED** | `BRAND-GUARDRAILS.md` §6 + roadmap RECEIPTS spec |
| 10 | **Taxonomy dishonest** (5-spine hides orphans) | **FIXED** | `CONTENT-ENGINE.md` §1 shows the honest 15-pillar map |
| 11 | **No owned-audience channel** (newsletter) | OPEN | roadmap day 90→180 |
| 12 | **No community / UGC loop** | OPEN | roadmap day 90→180 |
| 13 | **Paid + organic siloed** | OPEN | `PIPELINE-OS.md` §8 |
| 14 | **North-star is ER, not money** | **FIXED** | `funnel.json` → revenue per 1,000 reach = the wall number |
| 15 | **No annual campaign calendar** | PARTIAL | roadmap (January · Sept PCOS · wedding/festival season · Movember) |
| 16 | **No LTV / retention content** | OPEN | `funnel.json` follow-up rules + roadmap |
| 17 | **No hook A/B / outlier protocol** | PARTIAL | `hooks.json` arsenal; weekly test loop to schedule |
| 18 | **Intimidated-beginner content missing** | OPEN | QUEUE (beginner track) |
| 19 | **India-context thin** | OPEN | QUEUE (India track: veg protein, ₹ food, wedding prep) |
| 20 | **No reputation-defense playbook** | OPEN | roadmap day 90→180 |
| 21 | **Cadence has a ceiling, no floor** | **FIXED** | `CONTENT-ENGINE.md` §5 minimum-viable week |

## CRITIC 2 — the evidence skeptics (the science layer)
**Tier 0 — existential**
| # | Finding | Status | Fix lives in |
|---|---|---|---|
| 0.1 | The five-element spine **is pancha-mahabhuta** — the woo the brand bans | **FIXED** | `BRAND-GUARDRAILS.md` §3.1 — surface names NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL; `brand_gate.py` blocks elemental on-screen text |
| 0.2 | Mortality hooks sell **correlation as causation** | **FIXED** | §5 + the honesty chip ("A PROXY, NOT A VERDICT", shipped in EP-05) + gate check |
| 0.3 | **Wrong journal** on a headline citation (Mandsager is *JAMA Network Open*, not JAMA) | **FIXED** | `ERRATA-AND-CONFLICTS.md` + citation library |

**Tier 1 — overclaims & miscitations (13)** — all folded into `content/citation-library.json` wording:
0.6 µm vs 0.3 µm barrier → **locked ~0.3 µm** · water-% vs reference body → **70 kg M / 60 kg F stated** · 2 % dehydration → endurance/thermo/cognition robust, strength small · leucine 2.5–3 g ≠ protein-per-meal 20–40 g · Pontzer needs the fat-free-mass caveat · "exercise = first-line antidepressant" → mild–moderate/adjunctive · newbie gains (Damas 2016) · creatine = PCr/ATP first, hydration second · cold immersion context clause · static-stretch nuance (Behm 2016) · adaptive thermogenesis bounded + paired with reviews · small-n studies carry population + n · intestine 30 m² tied to a decision or demoted.

**Tier 2 — the missing depth (7)**
| # | Finding | Status |
|---|---|---|
| 2.1 | **GLP-1 + muscle preservation absent — the single biggest opportunity** | OPEN (roadmap W7–12 flagship pillar) |
| 2.2 | Cycle-syncing sold as settled → ship the honest version (this honesty IS the differentiator) | **FIXED** |
| 2.3 | Female physiology is a footnote → menopause/HRT pillar | PARTIAL |
| 2.4 | No variation layer → voice law 11 **"Range, not point"** (Hubal 2005: 0 % to +60 %) | **FIXED** |
| 2.5 | Programming truths missing → RIR/Refalo 2023 · volume dose-response · ROM (Pedrosa/Wolf 2023) · realistic gain rates · recomp honesty | **FIXED** (library entries added) |
| 2.6 | Testosterone = grift magnet → pre-write the honest ceiling | **FIXED** |
| 2.7 | Zone 2 / HRV trend-chasing → skeptical layer required | **FIXED** |

**Tier 3 — credibility hygiene (6)**
NASM-CPT de-emphasised for the peer tier (the citation IS the credential) · **borrowed slogans attributed** (Lyon, Slemenda) · **COI transparency** stated monthly · **contradiction gate** before publish · **ATP = labelled estimate** · **no free TTS on hero assets**.

---

## The 7 things to build next, in priority order
1. **THE REP** (exercise-demo backbone — Maddy's proven format) — Critic 1 · 3
2. **Practical food track** (Indian/veg, festival/wedding, ₹-per-40 g-protein) — Critic 1 · 2
3. **GLP-1 + muscle** flagship pillar — Critic 2 · 2.1
4. **MIND pillar expansion** (~25 psych topics) — Critic 1 · 1
5. **SECOND OPINION / CAUGHT** react-stitch show — Critic 1 · 5
6. **Search/YT-native engine** (MADE OF FIVE titles + metadata welded to site pSEO) — Critic 1 · 7
7. **Newsletter + community loop** (owned audience) — Critic 1 · 11–12
