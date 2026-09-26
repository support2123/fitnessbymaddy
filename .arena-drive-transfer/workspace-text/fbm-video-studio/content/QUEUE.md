# CONTENT QUEUE — what ships next, in order
> Rules: one topic per slot · each slot = DECODE 6 beats · order = reach first, then authority, then the seller bridge (the OS launch-slate logic).
> Topic IDs resolve to `content/topics.json`; every claim must resolve to a `status: locked` entry in `content/citation-library.json`.

## WAVE 1 — the launch slate (10 posts; #4 already shipped)
| # | Topic id | Post | Pillar → surface | Format / slot | Hook to use | Citation on the chip | Tier |
|---|---|---|---|---|---|---|---|
| 1 | `P04_WATER-01` | The scale lied to you this morning | FLUID | SCAN (Mon) | "Your weight changed overnight. Your fat didn't." | water-fluctuation physiology | T1 |
| 1a | `P04_WATER-02` | **WATER · "The Tax"** — the 7,500 L fact, the +3 bpm tax, the 8-glass lie, the protocol | FLUID | 🟡 **IN PRODUCTION — EP-06 WATER-01** · 1:56.8 s · 10 beats · publish pending | "Your heart moves 7,500 litres a day. You only hold five." | Adams 2014, Sports Med + Montain & Coyle 1992 | T2 |
| 2 | `P12_WOMENSPHYS-01` | Women don't get "bulky" | WOMEN'S | SCAN (Mon) | Hook archetype 3 — Corrected Lie | ACSM / endocrine reference ranges | T1 |
| 3 | `P03_FIRE-03` | Muscle burns ~6 kcal/lb, not 50 — who profited? | METABOLIC | STOP (Wed) | Hook 10 — Myth Autopsy | Elia/McClave; reconcile with "muscle is longevity" (contradiction gate!) | T2 |
| 4 | `P05_EARTH-01` | Grip strength predicts mortality more sharply than blood pressure | STRUCTURAL | ✅ **SHIPPED — EP-05 GRIP-01** (33.8 MB, sterile PASS) | "Your grip predicts death better than your blood pressure." | Leong 2015 Lancet (PURE) + "A PROXY, NOT A VERDICT" chip | T3 |
| 5 | `P01_SPACE-01` | Newbie gains: your brain *and* your muscle — sooner than we thought | NEURAL | SCAN (Mon) | "The first 4 weeks are your nervous system learning the movement." | ⚠ **corrected per Critic-2 1.7** — Sale 1988 + Damas 2016 (growth starts early; early size is partly edema) | T2 |
| 6 | `P02_AIR-01` | VO₂ max — the fittest number about you | RESPIRATORY | SCAN (Mon) / MADE OF FIVE seed | Hook archetype 2 — Identity Reframe | **Mandsager 2018, JAMA Network Open** (never "JAMA") + association language | T3 |
| 7 | `P03_FIRE-01` | Why you plateau — your body defends its weight | METABOLIC | STOP (Wed) → seller bridge | "You're not lazy. Your body is defending a set-point." | Fothergill 2016 **bounded** + Trexler 2014 (a few hundred kcal, not catastrophe) | T3 |
| 8 | `P10_RECOVERY-03` | Ice baths are quietly killing your gains | RECOVERY | STOP (Wed) | Hook 10 — Myth Autopsy | Roberts 2015 **+ context clause** (chronic post-lift CWI; fine between events) | T3 |
| 9 | `P15_HABITBEHAV-03` | Habits take ~66 days, not 21 | HABIT | SCAN (Mon) | "Day 21 isn't the finish line. It's the dip." | Lally 2010 (median 66; range 18–254) | T2 |
| 10 | `P03_FIRE-06` | Your metabolism doesn't crash at 30 | METABOLIC / AGEING | SCAN (Mon) → 40+ | Hook 3 — Corrected Lie | Pontzer 2021 (Science) **with the fat-free-mass caveat** | T2 |

**Wave-1 exit gate:** every asset passes `brand_gate.py`; the 3 s retention clears 65 % on ≥5 posts; one public errata published (the newbie-gains correction is the natural candidate — it's already written above).

## WAVE 2 — close the Critic-1 gaps (the content body)
| Order | Deliverable | Why now | Source of the brief |
|---|---|---|---|
| 1 | **THE REP** · first 3 episodes (squat / hinge / row: demo + cued form + muscle-map + Save & Try) | Maddy's proven IG format is missing from the slate — the volume backbone | `docs/CRITIC-BACKLOG.md` C1-3 |
| 2 | **Practical food** · 4 posts: high-protein veg meal · "40 g protein for ₹100" · wedding/diwali eating tactics · eating-out swaps | Highest-saved category on the platform; the audience lives here daily | C1-2, C1-19 |
| 3 | **GLP-1 + muscle** · flagship pillar opener: "how to keep your muscle on a GLP-1" (protein 1.6–2.2 g/kg · resistance training · rate-of-loss caps) | The #1 question in the 2026 fat-loss audience; nobody in the niche owns it with citations | C2-2.1 |
| 4 | **MIND** · 5 opener posts: why you quit at week 3 · all-or-nothing thinking · gym anxiety · food guilt · comparison/dysmorphia | The psychological barrier *is* the product for the named segments | C1-1 |
| 5 | **SECOND OPINION / CAUGHT** · first react-stitch: correct one viral bad-advice clip with the chip on screen | Highest-reach lever for an anti-misinformation enemy | C1-5 |
| 6 | **MADE OF FIVE** · monthly tentpole (10–16 min, 16:9) — the source rock for the next 12 cutdowns | Foundation of the search/YouTube engine | C1-7 |
| 7 | **Beginner track** · "your literal first day", "what every machine does", gym etiquette | A named segment with no content designed for it | C1-18 |
| 8 | **Menopause/peri strength** pillar opener (bone loss acceleration · protein · HRT context · power training) | The 40+ woman is a core buyer served by a footnote today | C2-2.3 |
| 9 | **Newsletter #1** (cited, weekly) | Reach is rented; the list isn't | C1-11 |
| 10 | **Process-proof RECEIPTS** · first consented 12-week client journey with check-in screen-shares | Proof-of-process > proof-of-photo for a misinformation-burned audience | C1-9 |

## STANDING SLOTS (every week, from the show bible)
Mon **SCAN** (science reel) · Wed **STOP** (myth-bust) · Fri **RECEIPTS** (transformation / process proof) · Sun **FORM LAB** (Live, 20–40 min) · daily **SCAN OF THE DAY** (3–7 story frames) · monthly **MADE OF FIVE** tentpole.
**Minimum-viable week** (when the machine slips, ship this — never nothing): 1 SCAN + 1 STOP + 1 story arc.

## SLOT FILLING — the 60-second path (how any topic becomes a queued post)
1. Pick the next topic from Wave 1/2 (or ask: which pillar is under-served in the last 10 posts?).
2. `python3 tools/engine/new_episode.py <TOPIC_ID>` → scaffold with the 6-beat skeleton + research brief.
3. Hook: choose one archetype, run the Three-Word Test + Screenshot Test (`content/hooks.json`).
4. Citation: pull the `locked` values for every number from `content/citation-library.json`.
5. Run the 9 strikes (`docs/CONTENT-ENGINE.md` §2) → publish → log the lesson in `docs/LESSONS-LOG.md`.
