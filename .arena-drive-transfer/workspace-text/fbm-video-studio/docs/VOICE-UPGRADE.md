# VOICE UPGRADE — v2 broadcast chain (24 Sep 2026)
> Applies to **both** VO paths: the cloned voice (`gen_vo_lib.py`) and the offline scratch voice
> (`gen_vo_scratch.py`). One tonal target means a film mixed against the scratch voice sounds like
> the film mixed against the clone — the swap changes the person, not the sound of the production.

## What changed (v1 -> v2)
| Stage | v1 | v2 |
|---|---|---|
| de-noise | none on scratch | `afftdn` on the clone floor only (gentle, -42 dB) |
| rumble | highpass 80 Hz | highpass 75 Hz |
| mud | one wide cut (-4 dB @ 350) | two narrow cuts (-3.0 @ 250, -2.4 @ 400) — boxiness removed without hollowing the voice |
| chest | none | +1.2 dB @ 190 Hz, low shelf +1.6 @ 150 Hz |
| nasal taming | none | -1.6 dB @ 1.5 kHz |
| presence | +3 @ 3.1 kHz | **+5.0 dB @ 3.2 kHz** (narrow Q 0.8) |
| air | high shelf +1.5 @ 8.8 kHz | +2.6 @ 8.5 kHz **+** high shelf +3.0 @ 11 kHz |
| dynamics | comp 2.5:1 @ -22 dB | comp 2.5:1 @ -19 dB, 10 ms attack, 230 ms release — speech sits forward without pumping |
| de-ess | i=0.22 | i=0.18 (less lisp, still safe) |
| space | none | **one short room reflection** `aecho=0.85:0.9:11:0.055` — a real room, not a plate |
| safety | none | `alimiter=limit=0.92` — peaks controlled before the master chain |

## Measured on the same sentence (m05, the hardest 18 s), both at -17 LUFS
| Band | v1 | v2 | Delta |
|---|---|---|---|
| mud (250-500 Hz) | 289.9 | 287.6 | -0.8 % |
| presence (2.5-5 kHz) | 62.3 | 70.1 | **+12.5 %** |
| air (8-16 kHz) | 9.6 | 10.5 | **+8.8 %** |
| peak | 0.842 | 0.841 | limiter engaged |

## Where it lives
- `tools/engine/gen_vo_lib.py` -> `CHAIN` (cloned voice)
- `tools/engine/gen_vo_scratch.py` -> `CHAIN` (offline placeholder)
- **Keep the two in sync** — they are the same chain apart from the clone's de-noise stage.

## The honest boundary
The chain cannot make a synthetic voice sound like a person. It makes the *production* sound
professional: less mud, more intelligibility, controlled peaks, one consistent room. The clone is
still the upgrade — and swapping it in is one command: `zsh tools/engine/swap_voice.sh <episode_dir> <film.py>`.
