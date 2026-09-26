# Production Runbook — one reel, no skipped gate

## 0. Intake

1. Create a Request Card with topic, duration, and optional tip.
2. Run `tools/ops/intake.py`.
3. Accept the router only when it chose the shortest complete tier. A topic with one clean point never earns Tier C.
4. The `planning.json` reveal decision is a slate recommendation. It does not authorize an unsupported hook.

## 1. Research and script

1. Build the research spine from locked entries in `content/citation-library.json`.
2. Mark research approval in `production-manifest.json` only after Maddy approves it.
3. Pick one of the twelve doctrine hook archetypes. Store distinct on-screen and spoken lines.
4. Write the tier beat map. Every beat must answer a different viewer question: tax, mechanism, myth, protocol, proof, or identity.
5. Write the turn in one line. If there is no turn, reduce scope or change the topic.
6. Pass Viral 6/6 and the sound-off screenshot test. Mark final-script approval.

## 2. Voice and timeline

1. Final authority release: use the cloned voice only. Scratch voice is permitted for layout tests, never a final authority asset.
2. Run `gen_vo_lib.py`, then `verify_vo.py`; inspect all number warnings manually.
3. Run `assemble_vo.py`. Picture never dictates timing; the measured timeline does.
4. Define the Living Clock before drawing the film. Its last cited value must coincide with the CTA timecode.

## 3. Hero open

1. Use `tools/ops/hero_open.py` to choose one psychological concept and write the prompt.
2. Generate without text baked in. Reject images that lack one dominant subject, one light, or a readable 150px thumbnail.
3. Composite typography on the hero. Export the identical 1080×1920 still as cover.
4. Use the exact still at frame zero; hold it 15–30 frames before the restrained living reveal begins.
5. Record hero lock fields in `production-manifest.json`.

## 4. Design, score, and mix

1. Build the reel over the hero, not after a title card.
2. Use no more than two type sizes in one frame; one red element maximum; gold is the single payoff hero.
3. Static scientific constants pop whole. The only rolling value is the Living Clock.
4. Every 4–6 seconds, introduce a new cited number, turn, or visual change. No static beat may exceed 2.5 seconds.
5. Run the episode bed recipe after the timeline. The doctrine mixer uses timeline-envelope ducking, not a live sidechain compressor.
6. Mix at −14 LUFS integrated, no higher than −1 dBTP, 48 kHz AAC.

## 5. QC and release

1. Preview all beat boundaries at full resolution before a full render.
2. Render, mux, run QC, then inspect every contact sheet and critical 1:1 crops.
3. Check the World-Class Bar: safe zone, color hierarchy, citations, Living Clock, motion, contrast, and sound.
4. Run Fresh Eyes. Ship only at 8.5 or higher with no unresolved critical finding.
5. Run `brand_gate.py`, `publish_ig.py`, then `tools/ops/preflight.py --stage release`.
6. Prepare the upload pack: sterile master, cover still, caption, pinned comment, source line, comment keyword, and series-loop line.
7. Human uploader manually selects the locked cover in the platform UI and records the publish approval.

## Fast repair law

- Audio-only defect: regenerate/mix/remux. Do not render the picture again.
- Visual defect: fix the affected window, preview the boundary, then use a keyframe-aligned splice or a clean re-render.
- Wrong claim, citation, or confidence language: stop release. Correct script, re-record affected VO, regenerate timing, then re-run every downstream gate.
