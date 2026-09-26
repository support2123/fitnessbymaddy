# WATER-01 · FRESH-EYES AUDIT

Cold watch, no context, phone in hand, sound on. Scored against the studio bar
(does it earn the first 3 seconds, does it teach, does it feel expensive, would it be forwarded).

## Verdict — **8.6 / 10 · SHIP**

| axis | score | note |
|---|---|---|
| cold open | 9.0 | frame 0 is the +3 BPM slam, not a logo. The clock is the film's best idea. |
| clarity | 8.5 | one number per beat. 7,500 L, 42 L, +3 BPM, 4%, 14, 180 L, 99%, 1.4 kg. |
| honesty | 9.5 | the lab-vs-road beat and the cramps receipt are the most trustworthy 20 s on the feed. |
| craft | 8.5 | one clock in HUD, ECG and score; chips hold 6.4 to 7.6 s, long enough to read twice. |
| CTA | 8.0 | "COMMENT WATER." asks for a literal answer; the ask dominates the pill. |
| retention risk | — | m05 is the longest beat (18.4 s) but it carries the danger reveal. Watch replay rate here. |

**Would a stranger forward it?** Yes — the 1945 report line and the 14-athlete line are the two
moments people quote back. Keep them exactly where they are.

**What a stranger said, in one line:** "I came for the water bottle, I stayed because it told me
my heart rate climbs 3 beats for every percent I sweat out."

## Checks

- [x] Sterile: zero tool/AI markers anywhere in metadata or on screen
- [x] Every number on screen carries a cite chip (8 chips, locked `fluid.*` claims)
- [x] Loudness −14.0 LUFS / ≤ −1.0 dBTP; CTA slam does not clip
- [x] Layout law held: nothing crosses HEAD 400 / CITE 330 / CHAP 46 / CRED 250
- [x] One CTA only; no price anywhere
- [x] Loop: the last frame returns to the vessel the protocol was taught on

## Rebuild addendum (24 Sep 2026)

Audit re-run by eye on the rebuilt cut after the preview pass caught four engine/layout defects.
All were invisible at contact-sheet scale and obvious at 1:1:

1. **Right-aligned stamp label** — `stat_stamp` tested `anchor.endswith()` (False for "rt"/"ct"),
   which pushed m03's label off the right edge. Now keyed on `anchor[0]`.
2. **Dead overlays** — one top-level `o` computed from beat 1 zeroed every cite chip and the pulse
   HUD from beat 2 onward. Now per-beat.
3. **Protocol rows under the headline** — m07's instruction rows sat at y 300, colliding with the
   kicker block (which owns everything above HEAD_BOTTOM 400). Rows now start at 700, receipt at 1120.
4. **Chip text ragged** — chips are written as flowing prose now; the wrapper does the wrapping.

Same beats, same copy, same clock: the 8.6 SHIP call stands.
