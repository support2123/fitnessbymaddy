# ERRATA & CONFLICTS — where the sources disagree, and what we locked
> Rule: **one number, used everywhere.** When two defensible numbers exist, pick ONE, write it here, and retire the other from every asset.
> Referenced by `docs/BRAND-GUARDRAILS.md` and enforced (prices) by `tools/engine/brand_gate.py`.
> Status: 🔒 locked · ⏳ awaiting Maddy's call · 📝 noted (no action).

---

## A · PRICE & OFFER LADDER — 🔒 **DECIDED 24 Sep 2026 (Maddy): the live site is canonical**
Two ladders exist. **Client-facing assets must not mix them.**

| Offer | DECODER OS (internal doc) | Live site (verified 20 Sep 2026) | Verification page |
|---|---|---|---|
| Entry / tripwire | **Burn & Build ₹999** | 6-Week Fat Loss **₹1,499 / $20** · Core Shred **₹1,499 / $20** | — |
| Core | **Customised 12-Week ₹9,999** (couple ₹14,999) | 12-Week Customised **₹5,999 / $70** | — |
| Premium | **1-on-1 Live ₹27,000** (20 → ₹39,999 · 36 → ₹64,800) | Live 1-on-1 **from ₹20,000 / $250** | 12 h = ₹20,000 · 20 h = ₹32,000 · 36 h = ₹54,000 · 72 h = ₹1,00,000 |
| Side doors | PCOS Warrior ₹2,999 · 40+ Strong ₹3,999 · Women ₹2,999/mo · HIIT ₹2,999/mo | — | HIIT (Vinay) ₹11,999 · Youth (Nitin) ₹11,999 |
| Plan names | Burn & Build · Customised 12-Week · Live | 6-Week Fat Loss · Core Shred · 12-Week Customised · Live 1-on-1 | same as live site |

**Final rule:** published content quotes the **live site** numbers and names — ₹1,499 · ₹1,499 · ₹5,999 · Live from ₹20,000 — because that is what a viewer can actually buy today. The DECODER OS ladder (₹999 / ₹9,999 / ₹27,000 / side doors) is **internal planning only** and must never appear in a caption, frame or CTA until the website itself changes. Any future repricing starts by editing this file first.
**Enforcement:** `brand_gate.py` BLOCKS `₹999` / `₹9,999` / `₹27,000` in captions and on-screen film text, with the reason printed. Enforced by `brand_gate.py` (blocks ₹999 / ₹9,999 / ₹27,000 in captions + on-screen film strings).

## B · THE FIVE SYSTEMS — naming 🔒
The doc insists SPACE/AIR/FIRE/WATER/EARTH is "only a secular scaffold"; the skeptic review says it reads as the *pancha mahabhuta* and is exactly the woo the brand bans (Critic-2 0.1).
**Locked** (confirmed by Maddy, 24 Sep 2026): internal taxonomy keeps the five labels (curriculum, filings, pillar IDs). **Every client-facing surface uses NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL** (alt: NERVE · LUNG · CELL · BLOOD · FRAME). "MADE OF FIVE" survives as a *show title* (it names a count, not an element). EP-03/04/05 already comply — no elemental word appears on any shipped frame.

## C · BLOOD-GAS BARRIER — 0.6 µm vs 0.3 µm 🔒
The OS ships both (Section 1 hook: 0.6 µm; Section 8 worked example: 0.3 µm). Both are "right" (mean tissue thickness vs the thinnest gas-exchange side) — but shipping both is the exact screenshot-mockery this brand exists to avoid (Critic-2 1.5).
**Locked: ~0.3 µm at its thinnest** (West). The 0.6 µm figure is **retired**. The MADE OF FIVE film line is corrected to 0.3 µm on any reissue.

## D · WATER, % vs REFERENCE BODY 🔒
"~60 % / ~42 L" is a **70 kg male**. The OS also declares a "60 kg female" reference body — a 60 kg woman is ~50–55 % water ≈ **~31 L**, not 42 L (Critic-2 1.6).
**Locked:** the 70 kg M / 60 kg F pair is stated *in the asset* whenever body-water is the claim, and no asset mixes the two. Female-specific posts use the female figure.

## E · CITATION HYGIENE — five corrections now in the library 🔒
| Wrong as published | Corrected | Where |
|---|---|---|
| "Mandsager, **JAMA** 2018" | Mandsager et al., **JAMA Network Open** 2018 | `air.vo2max_mortality` |
| "2 % dehydration = strength loss" | endurance · thermoregulation · cognition · RPE are the robust effects; max-strength effect small (~2 %) | `fluid.dehydration_2pct` |
| "leucine threshold ~20–40 g" | **per-meal protein** 20–40 g (~0.4 g/kg); **leucine** threshold 2.5–3 g | `programming.leucine_per_meal` |
| "newbie gains are neural, not muscular (Sale 1988)" | both — measurable hypertrophy starts earlier than the old model (Damas 2016); early size partly edema | `programming.newbie_gains` |
| "creatine = cell hydration" | primary mechanism is phosphocreatine/ATP resynthesis (Kreider 2017); volumization secondary | `supp.creatine` |
Plus, in the same sweep: exercise & depression = mild–moderate/adjunctive (never "first-line") · cold-immersion context clause · static-stretch nuance (Behm 2016) · adaptive thermogenesis bounded · small-n studies carry population + n · ATP labelled an estimate · intestine 30 m² tied to a decision.

## F · RUNTIME & FORMAT DRIFT 📝
- MADE OF FIVE runtime appears as **8–18 min** (§6.1 format table) and **10–16 min** (§6.5 tentpole). **Engine convention: 10–16 min** for the monthly tentpole; 8–18 min is the format's outer ceiling.
- OS reels are specced 30–45 s (SCAN) / 60–90 s (STOP) while the **shipped EP-05 is 71.8 s** — inside the STOP band, above the SCAN band. No conflict; a note for slate planning (SCAN episodes must hit 30–45 s).
- Audience size written as 2M / 2.1M / 2.08M → **use 2.08 M** (verification page, 20 Sep 2026).

## G · VOICE & AV 🔒
- edge-tts / any free neural TTS: **internal drafts only**, never a published authority asset (Critic-2 3.6). EP-05's piper VO is exactly such a placeholder and is flagged as such in `episodes/GRIP-01/README.md`.
- Claim language: *"one study found…"* for single-RCT/cohort (T2), *"mechanistically / plausibly / an estimate"* for T3. Absolute verbs (guarantees · cures · detoxes · melts fat · resets your metabolism) are banned everywhere.
- Correlation hooks (VO₂max, grip, sit-rise) always carry an on-screen honesty chip — EP-05's *"A PROXY, NOT A VERDICT"* is the reference implementation.

## H · HOW ERRATA GETS PUBLISHED (the culture, not just the file)
1. A correction found internally → logged here the same day.
2. The affected asset is corrected (kit order: re-render → mux → QC → sterile publish) and the old file is archived, never silently deleted.
3. Public correction post once a month ("here's what we got wrong, here's the paper") — the errata itself is content. Trust is the product; this is how it compounds.
