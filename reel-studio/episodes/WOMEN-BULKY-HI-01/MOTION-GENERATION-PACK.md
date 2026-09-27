# LIVE MOTION GENERATION PACK — WOMEN-BULKY-HI-01

This is an operator handoff, not a vendor-API promise. Export muted, vertical MP4 clips to the exact paths in `motion-manifest.json`; the film stage owns final score and dialogue.

## Locked continuity contract

- **Subject reference:** `hero/approved-reference.png`
- **Style reference:** `hero/style-reference.png`
- **Lighting:** `upper_left` · **WB:** 4800–5200K
- **Camera:** slow push-ins and dollies only; no random whip pans or speed ramps
- **House grade:** Editorial Athletic: matched blacks, matched contrast, graphite/gold/cyan palette
- **No embedded text, logos, UI, watermark, native audio, or random grain.**
- Lock one reference image + one style reference across generated human shots. Append rerolls (`_v2`, `_v3`); do not overwrite a selected clip.

## Beat contracts

### m00 · 0.00s–4.09s · hook_fear

- **Provider lane:** `veo_3_1` — Veo 3.1 — cinematic atmosphere, volumetric light, and resolve shots; mute native audio
- **Deliver:** `assets/motion/m00_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 5s
- **Motion:** slow_push_in + drifting_dust
- **One moving hero:** ominous forward camera push
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** desaturate -15%, cool toward graphite
- **Seed:** `12031` · **cache key:** `17fb7083243cd75b5e17`
- **Hero cover lock:** first frame pixel-matches `hero/cover.png`; hold exactly `21` frames before visible motion.

```text
ominous forward camera push; story context: Women don't get "bulky". Beat intention: वेट उठाने से महिलाएं अचानक भारी भरकम नहीं होतीं।. Motion: slow_push_in + drifting_dust. 9:16 vertical composition, 1080x1920, 30fps master. One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, 4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. Generate at least one second longer than the required beat for editorial trim headroom.
```

### m01 · 4.09s–11.10s · myth_fear

- **Provider lane:** `runway_gen4` — Runway Gen-4 / Gen-4 Turbo — controlled image-to-video and reference-led hero motion
- **Deliver:** `assets/motion/m01_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 10s
- **Motion:** restrained_push + micro_drift
- **One moving hero:** single athlete or training object under tension
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** graphite base, danger red only for emphasis
- **Seed:** `12132` · **cache key:** `e12629a364f9b468b20e`

```text
single athlete or training object under tension; story context: Women don't get "bulky". Beat intention: आप एक डंबल सेशन में अपना शरीर नहीं बदल देतीं। यही डर बहुत सी महिलाओं को ताकत बनाने से रोकता है।. Motion: restrained_push + micro_drift. 9:16 vertical composition, 1080x1920, 30fps master. One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, 4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. Generate at least one second longer than the required beat for editorial trim headroom.
```

### m02 · 11.10s–20.18s · mechanism

- **Provider lane:** `complete_anatomy_capture` — Complete Anatomy / BioDigital capture — animated anatomy only
- **Deliver:** `assets/motion/m02_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 10s
- **Motion:** rhythmic_physical_cycle + slow_orbit
- **One moving hero:** one body system visibly moving
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** cyan science key, matched graphite blacks
- **Seed:** `12233` · **cache key:** `c2304963251d34ba01e4`

```text
one body system visibly moving; story context: Women don't get "bulky". Beat intention: महिलाओं पर हुई रिसर्च बदलाव को चार हफ्तों से बारह महीनों तक मापती है, एक वर्कआउट में नहीं। असली बदलाव धीरे धीरे बनता है।. Motion: rhythmic_physical_cycle + slow_orbit. 9:16 vertical composition, 1080x1920, 30fps master. One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, 4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. Generate at least one second longer than the required beat for editorial trim headroom.
```

### m03 · 20.18s–33.25s · proof_graph

- **Provider lane:** `fusion_motion_graphics` — Resolve Fusion / After Effects / Remotion — data drawing over a moving ground
- **Deliver:** `assets/motion/m03_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 10s
- **Motion:** data_draw + continuous_graphite_drift
- **One moving hero:** one drawing line or proof marker
- **Loop:** YES — extend/loop without a tail freeze
- **Grade:** bone type, cyan proof accent, no dead panel
- **Seed:** `12334` · **cache key:** `a6dc670529bcfdb81eca`

```text
one drawing line or proof marker; story context: Women don't get "bulky". Beat intention: दस स्टडीज़ में, एक ही प्रोग्राम करने पर, महिलाओं और पुरुषों की रिलेटिव मसल ग्रोथ में कोई मायने रखने वाला फर्क नहीं मिला। महिलाएं मसल बना सकती हैं। लेकिन भारी भरकम होना कोई हादसा नहीं है।. Motion: data_draw + continuous_graphite_drift. 9:16 vertical composition, 1080x1920, 30fps master. One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, 4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. Generate at least one second longer than the required beat for editorial trim headroom.
```

### m04_squat · 33.25s–36.91s · protocol

- **Provider lane:** `artgrid_stock` — Artgrid / approved licensed stock — authentic human effort and gym texture
- **Deliver:** `assets/motion/m04_squat_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 5s
- **Motion:** controlled_squat + slow_dolly
- **One moving hero:** one athlete executing a controlled squat or leg press
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** Editorial Athletic; human skin 62–70 IRE; graphite shadow floor; no grain
- **Seed:** `12435` · **cache key:** `9e0e37f31329edfd79ec`

```text
Real athlete performing a controlled squat or leg press, real load physics, knees and feet anatomically credible, slow dolly toward the working lower body, single moving subject, steady gym background, no embedded type or logos. 9:16 vertical composition, 1080x1920, 30fps, muted, upper-left key, 4800–5200K, Editorial Athletic grade target.
```

### m04_row · 36.91s–40.58s · protocol

- **Provider lane:** `artgrid_stock` — Artgrid / approved licensed stock — authentic human effort and gym texture
- **Deliver:** `assets/motion/m04_row_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 5s
- **Motion:** controlled_row + slow_dolly
- **One moving hero:** one athlete executing a controlled row
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** Editorial Athletic; human skin 62–70 IRE; graphite shadow floor; no grain
- **Seed:** `12436` · **cache key:** `101d0d36366fab059d77`

```text
Real athlete performing a controlled rowing movement, visible scapular control and natural resistance, slow dolly toward the working upper back, single moving subject, steady gym background, no embedded type or logos. 9:16 vertical composition, 1080x1920, 30fps, muted, upper-left key, 4800–5200K, Editorial Athletic grade target.
```

### m04_press · 40.58s–44.24s · protocol

- **Provider lane:** `artgrid_stock` — Artgrid / approved licensed stock — authentic human effort and gym texture
- **Deliver:** `assets/motion/m04_press_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 5s
- **Motion:** controlled_press + slow_dolly
- **One moving hero:** one athlete executing a controlled press
- **Loop:** No loop needed if delivered longer than the beat
- **Grade:** Editorial Athletic; human skin 62–70 IRE; graphite shadow floor; no grain
- **Seed:** `12437` · **cache key:** `02eb3d1d90ce72ba3b0a`

```text
Real athlete performing a controlled press, natural shoulder path and real weight physics, slow dolly toward the working muscle, single moving subject, steady gym background, no embedded type or logos. 9:16 vertical composition, 1080x1920, 30fps, muted, upper-left key, 4800–5200K, Editorial Athletic grade target.
```

### m05 · 44.24s–55.93s · cta_resolve

- **Provider lane:** `runway_gen4` — Runway Gen-4 / Gen-4 Turbo — controlled image-to-video and reference-led hero motion
- **Deliver:** `assets/motion/m05_v1.mp4` · 1080x1920 · 30fps · muted MP4 · at least 10s
- **Motion:** confident_forward_push + restrained_gold_bloom
- **One moving hero:** one forward resolve subject
- **Loop:** YES — extend/loop without a tail freeze
- **Grade:** gold resolve over graphite, steady camera
- **Seed:** `12536` · **cache key:** `fcff69af9427fd724c33`

```text
one forward resolve subject; story context: Women don't get "bulky". Beat intention: जिस लिफ्ट से तुम बचती हो, उसे कमेंट करो। Fitness By Maddy को फॉलो करो। हम सिर्फ बॉडी के पीछे नहीं भागते। हम तुम्हें अपना शरीर पढ़ना सिखाते हैं।. Motion: confident_forward_push + restrained_gold_bloom. 9:16 vertical composition, 1080x1920, 30fps master. One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, 4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. Generate at least one second longer than the required beat for editorial trim headroom.
```

## Before handing clips to Film

```bash
python3 tools/engine/motion_manifest.py episodes/WOMEN-BULKY-HI-01 validate --strict
python3 tools/engine/motion_qc.py episodes/WOMEN-BULKY-HI-01
```

A missing MP4, a still image, near-static two-second window, duplicate shot, freeze-tail, or unmatched grade is a rebuild—not a delivery exception.
