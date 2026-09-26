# FRESH-EYES AUDIT · EP-05 GRIP (Strike 8)
**Auditors:** creative director pass + compliance pass (independent of the builder)
**Method:** every contact sheet in `qc/` reviewed, plus 8 full-resolution frames pulled
(`ffmpeg -ss <t> -frames:v 1`) at 5.0 · 12.8 · 31.0 · 44.0 · 47.8 · 60.0 · 65.5 · 69.4 s
**Artifact audited:** `GRIP-01-PUBLISH.mp4` — 1080×1920 · 30 fps · 71.83 s · −14.0 LUFS · −1.0 dBTP · sterile PASS

---

## SCORES

| Axis | Score | Note |
|---|---|---|
| Hook latency | **10/10** | Frame 0 is the film's best moment (the 16% gold slam) — motion payoff before any title card. Cold-open rule honoured. |
| Clarity per beat | **9/10** | Every beat's claim, number and citation land together; nothing needs re-reading. |
| Pacing | **8/10** | Longest static stretch is 2.6 s (m06 ladder). No dead zone over 3 s. |
| Visual craft | **8.5/10** | Camera narrates (every shot has a move); grain + vignette read filmic, not template. |
| Retention engineering | **8/10** | New information every 4-6 s; chapter tags signpost without becoming a listicle. |
| Compliance & brand | **10/10** | Citation on every stat, honesty chip for the observational limit, no medical claim, one CTA. |
| **OVERALL** | **8.1 / 10** | 5 = average edited fitness reel · 7 = strong branded content · 9 = best-in-class science reel |
| **VERDICT** | **SHIP WITH TWEAKS** | (tweaks below; none block publishing) |

---

## FINDINGS (timestamped)

1. **12.8 s — FIXED BEFORE SHIP (critical).** The line "AND YOU CAN TEST IT IN 5 SECONDS" sat on the headline's descenders. Moved to y=1152 (above the head block, below the gauge). Re-rendered that window and spliced at the frame boundary.
2. **65-69 s — FIXED BEFORE SHIP (major).** The CTA stack showed the ask above the question and the funnel pill too high in the hierarchy. `cta_block` rebuilt to the kit's top-down order: headline → italic → question → **TYPE IT BELOW** (dominant, gold glow) → quiet pill → credential. Re-rendered the m08 window and spliced.
3. **62.6 s (minor, accepted).** The `+4 KG` sub-label "MEAN GRIP GAIN · 22 RANDOMISED TRIALS" runs over the carrying body at 0.86 opacity. Legible at 100 % but the weakest frame pair in the film. Next episode: move labels to the left column when the subject occupies frame-right.
4. **m06 (minor, accepted).** The norms ladder's four rows are dense for a phone at arm's length — but they are the proof, and the spoken line only needs the 12/14 pair. Kept intentionally: the ladder is the screenshot people share.
5. **Cover (minor).** Feed cover's bottom row is at 300 px from the bottom — safe for the grid, but on a 4:5 crop in some clients the `COMMENT YOUR NUMBER` line sits near the caption boundary. Acceptable; the story variant has full breathing room.

## SYNC SPOT-CHECKS (spoken number vs on-screen, ±1 s law)
| Spoken | VO time | On-screen | Δ |
|---|---|---|---|
| "sixteen percent" | ≈19.3 s | 16% stamp at 18.92 s | +0.4 s ✔ |
| "twelve stands" | ≈46.9 s | 12 stamp at 46.44 s | +0.5 s ✔ |
| "fourteen for a man" | ≈48.6 s | norms ladder row 2 pops 47.6 s | +1.0 s ✔ |
| "four kilograms" | ≈60.4 s | +4 KG stamp at 60.84 s | −0.4 s ✔ |

## WHAT THE FILM DOES THAT MOST REELS DON'T
- The claim arrives with its **paper** on screen in the same beat (Lancet · Rikli & Jones · STEADI · J Clin Med).
- The honesty beat is **in the film**, not in the caption — "a proxy, not a verdict" is the brand's actual moat.
- One **typeable** CTA (a number the viewer already counted), asked ONCE, with the funnel kept deliberately quiet.

## TOP 3 HIGH-IMPACT NEXT-UPS (feed straight into EP-06)
1. **Real cloned VO** — replace `gen_vo_scratch.py` output with the ElevenLabs clone (`FBM_VOICE_ID`). Costs nothing else; the timeline auto-rebuilds from the new durations.
2. **Custom end-card loop** — make the last 1.2 s loop seamlessly back into frame 0 for the Explore-page re-watch.
3. **Add a "you vs the average" bar** in m06 — two bars (your count, the 12/14 line) so the number becomes visual, not just typographic.

## PRODUCTION HONESTY NOTE (must be stated when delivering)
The delivered `GRIP-01-PUBLISH.mp4` carries a **scratch narration** (offline neural voice) so the
film, timeline, score and QC gates could be built end-to-end in one sitting without an API key.
The film is fully VO-led: when the real clone is generated, `assemble_vo.py` recomputes
`timeline.json` and the film re-renders against the measured times — no design change required.
