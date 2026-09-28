# Render QC — WOMEN-BULKY-01 · live-motion rebuild

**Render date:** 28 September 2026 · local recovery rebuild

**Master:** `WOMEN-BULKY-01-PUBLISH.mp4` (local delivery file)

**SHA-256:** `920089a759ee12bc749231ae9866ddc18db97d47b0b2e993cecd226296620300`

The recovered local master uses the same locked Clone-3 source, VO-led timeline, live-motion assets, film module, and master settings as the prior review build. It remains a **review master**, pending the human release gates below.

## Render and media checks

| Check | Result |
| --- | --- |
| Duration | 44.30 s |
| Video | H.264 · 1080×1920 · 30 fps |
| Decode sweep | PASS — clean |
| Integrated loudness | −14.0 LUFS |
| True peak | −1.2 dBFS / dBTP ceiling target |
| Manual music ducking | PASS — six timeline-led voice windows, 150 ms attack / 400 ms release |
| Sterile publish scan | PASS — no prohibited metadata-zone marker found |
| Brand gate | PASS |

## Live-motion evidence

`qc/MOTION-QC.json` records eight checked MP4 backgrounds. It passed strict source availability, 1080×1920/30 fps inspection, Farnebäck optical-flow motion checks, no freeze-tail, distinct-shot pHash checks, and grade-drift review with **0 warnings**.

The final visual inspection used two timestamped contact sheets (00:02.5–00:45.0). Review confirmed: full-bleed hero at frame zero, visible per-word kinetic type, lifted citations, distinct moving athlete shots, Living Clock in the top-right, owned-number CTA, `@fitnessbymaddy_`, and the final next-reel loop.

## Honest remaining gate

This is a **review master, not an approved social upload**. The source audio passed mechanical intake, timing, format, and clipping checks, but the sandbox could not download the external Whisper model for an automatic transcript comparison and a final human listener sign-off remains outstanding. `production-manifest.json` deliberately remains publish-pending until that sign-off and Fresh Eyes review are recorded.
