# LIVE MOTION RUNBOOK
## The end-to-end B-roll and motion direction lane

This is the operational implementation of `DOCTRINE-04-LIVE-MOTION.md`. It is designed to equal or exceed a vendor-specific workflow by keeping the **direction contract, continuity lock, source selection, grade, QC, and rebuild decisions** under our control. A generator creates a clip; it does not define the film.

## 1. One-time workstation setup

```bash
cd reel-studio
make bootstrap
```

This installs Pillow/Numpy plus `opencv-python-headless`. OpenCV is required in release mode for Farnebäck optical-flow QC. The renderer finds ffmpeg via `binpaths.py`.

## 2. The live-asset stage

The stage starts only after final narration timing is measured:

```bash
python3 tools/engine/assemble_vo.py episodes/<EP>
python3 tools/engine/motion_manifest.py episodes/<EP> plan
```

This creates:

- `motion-manifest.json` — source of truth for shot windows, selected clip locations, continuity data, prompt/seed/reference contract, and cache keys.
- `MOTION-GENERATION-PACK.md` — a practical operator handoff, one brief per beat.
- `assets/motion/` — local-only destination for selected `.mp4` clips.

Do **not** replace this manifest with a spreadsheet or loosely named downloads. The Film renderer and QC use this exact contract.

## 3. Choose the best lane per beat

The system is provider-neutral by design. It accepts an exported MP4 from an authorized workflow and does not pretend to automate vendor UIs without approved access.

| Story need | Best lane | Operator decision |
| --- | --- | --- |
| Premium cinematic hero/atmosphere | Veo / Runway / Luma / Higgsfield / Hyperframe / Open Director | Pick the strongest controlled slow-push result, not the first usable result. |
| Lift, sweat, hand, bar, real biomechanics | Artgrid or other licensed real footage; Kling only if it genuinely passes anatomy review | Human physics has a higher realism bar than abstract visuals. |
| Body-system explanation | Complete Anatomy, Blender, or legitimate medical capture | The body system must visibly pulse, contract, glide, or flow. |
| Long environment/micro-sequence | Sora lane or operator-approved direction tool | Use only where continuity actually needs it. |
| Keyframe transform | Pika / Fusion / AE | Use for a readable mechanism transition, not decoration. |
| Proof beat | Fusion / AE / Remotion over a moving ground | The line/data mark draws itself; the background still lives. |

Higgsfield, Hyperframe, and Open Director are accepted as **operator-authorized direction/export lanes** in the manifest. Select their current best model/mode in their own authorized product UI, then export a muted vertical MP4 into the manifest’s exact path. The pipeline owns the non-negotiables regardless of which provider wins a particular shot.

## 4. Direction lock before generation

Before any render, lock these once for the entire reel:

1. subject reference image;
2. style reference image;
3. seed per shot (append-only rerolls);
4. upper-left key direction;
5. 4800–5200K white balance target;
6. slow monotonic push/dolly camera language;
7. Editorial Athletic grade target; and
8. no baked text, logo, UI, watermark, native audio, or grain.

All values belong in `motion-manifest.json`. A random new character, flipped light direction, whip-pan, or warm/cool surprise is rejected before Film.

## 5. Clip delivery contract

For each selected row:

- export **muted MP4**, 1080×1920, 30fps;
- generate 5s ambient or 8–10s action, with at least 1s trim headroom;
- set `loop: true` if source duration is shorter than beat duration;
- use native loop, matching keyframes, or a short editorial crossfade—never a frozen tail;
- retain raw source separately from graded output; the manifest points only to the selected version;
- create rerolls as `_v2`, `_v3`; do not overwrite `_v1`.

A no-clip exception does not exist. The only fallback is all four together: multi-plane 2.5D segmentation, depth-map displacement, drifting particles, and a continuous 3–6% push.

## 6. Hard validation and motion QC

```bash
python3 tools/engine/motion_manifest.py episodes/<EP> validate --strict
python3 tools/engine/motion_qc.py episodes/<EP>
```

`validate --strict` blocks missing `.mp4` files, still paths, coverage gaps, invalid looping, missing continuity data, missing prompt/seed/reference, and a grade policy with grain.

`motion_qc.py` blocks:

- any two-second optical-flow window below the motion floor;
- freeze-frame padding at a tail;
- reused/near-identical shots under the pHash threshold.

It warns when luma/chroma differs materially from the chosen reference clip. A warning gets color-matched before render; a blocker goes back to B-roll. The report is saved at `episodes/<EP>/qc/MOTION-QC.json`.

## 7. Film, score, and CTA requirements

The Film layer decodes selected live clips directly via `motion_media.py`, cover-crops them consistently, then lays type/citation/clock above them. The portable `kinetic_words()` component provides per-word clip-mask + y-rise and seven-frame overshoot; `stat_stamp()` remains the only correct treatment for a fixed number.

The Living Clock must be prominent top-right, drive environment/telemetry/trace from one curve, and land on the exact CTA frame. The bed recipe must invert/map that same curve to score ticks, including the final landing impact.

The last two seconds are reserved for a literal owned reply prompt and a series tease. Citations are lifted above the bottom platform UI zone.

## 8. Release record

After all gates pass, update `production-manifest.json` only with evidence:

```json
{
  "motion": {
    "status": "PASS",
    "every_beat_moving": true,
    "distinct_shots": true,
    "house_grade": "PASS",
    "optical_flow_qc": "PASS",
    "freeze_tail_qc": "PASS"
  },
  "design": {
    "living_clock": {
      "prominent_top_right": true,
      "score_synced": true,
      "lands_on_cta": true
    },
    "kinetic_type": {"word_reveal": true, "fixed_number_pop_land": true},
    "citations_lifted": true
  },
  "quality": {"motion_qc": "PASS"}
}
```

Then, and only then, the standard audio, technical QC, brand, Fresh Eyes, sterile publish, and upload gates continue.

## 9. Definition of done

A reel is not world class because a vendor name appears in a prompt. It is world class when every frame has intentional live narrative motion, every clip belongs to one visual film, type and clock clarify rather than decorate, evidence stays readable, and the automated gates can prove it did not ship as a motion poster.
