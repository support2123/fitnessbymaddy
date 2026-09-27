# ARENA UPGRADE — PATCH v2
## Live motion and audited gap fixes

**Apply on top of `00-MASTER-SPEC.md`. This patch only upgrades; it does not lower the current bar.**

---

## Audit finding

The Women-Bulky English and Hindi cuts already achieved cover-led hero opens, Tier-B pacing around 52–56 seconds, cited statistics, an honest reframe, −14 LUFS, and per-beat scene variety. The Hindi on-screen Roman-Hinglish is readable and remains correct.

The confirmed remaining primary defect was frozen pixel backgrounds: images changed per beat, but three consecutive frames half a second apart were identical. A press visual did not contain a press and a squat visual did not contain a squat.

Secondary defects were a faint Living Clock, template-like static text panels, no last-two-seconds series loop, and citations riding too low near platform UI.

---

## FIX 1 · LIVE MOTION BACKGROUNDS

Adopt `DOCTRINE-04-LIVE-MOTION.md` in full.

- Every beat uses a moving clip, never a static image.
- Insert the required **ASSET / B-ROLL** stage after Timeline + Hero and before Score / Film.
- Film receives a per-beat clip set via `motion-manifest.json`; every row has `.mp4` `clip_file`, `motion_type`, and loop decision.
- Generate with the best lane for the beat: image-to-video (Runway Gen-4 / Kling 2.5 / Veo 3.1 / Luma loops), real licensed footage (Artgrid / Storyblocks / Pexels where appropriate), or animated anatomy (Complete Anatomy / Blender).
- Lock one seed, style reference, and approved reference image per reel.
- If a true clip is impossible, use only the four-part 2.5D fallback defined by Doctrine-04—never a flat scaled image.
- Add automatic motion QC: no static beat >2s, distinct-shot pHash, and freeze-frame-padding detection. A failure returns to ASSET / B-ROLL.

## FIX 2 · LIVING CLOCK IS A HERO

- The reel’s single signal must be prominent, not a faint bottom trace.
- It occupies the top-right safe region above the icon rail.
- Author from the CTA backwards: `value(T_cta) = final_value` on the exact CTA frame.
- The landing has a visible impact/pulse and a matching score tick. Every intermediate tick maps to the same value curve.

## FIX 3 · TRUE KINETIC TYPOGRAPHY

- Replace static template panels with the Doctrine-03 kinetic system.
- Fixed numbers pop-land with a seven-frame overshoot; they never count up.
- Words reveal per-word using clip-mask + y-rise, staggered to spoken language.
- One emphasis word maximum per line, rendered red italic.
- Scrims may remain for contrast, but no panel may carry a static type payload.

## FIX 4 · CTA SERIES LOOP

The final two seconds combine:

1. one literal owned reply prompt; and
2. one line that opens the next reel.

The question must be answerable from the viewer’s own experience. The series tease must survive as a clear visual line through the final two seconds.

## FIX 5 · LAYOUT

- Citations lift above the bottom platform UI zone; portable film modules use citation bottom ≥400px.
- The Living Clock remains top-right, clear of the right-side icon rail.
- Safe core and hard floor remain unchanged.

---

## Hindi cut preservation rules

- Keep on-screen copy in **Roman-Hinglish**; do not switch to Devanagari without a verified render-safe font/shaping path.
- Keep `DECODE · HINDI FITNESS`, `FOLLOW KARO`, and `@FITNESSBYMADDY_`.
- Hindi clone VO is a separate authority asset; all motion, clock, type, citation, QC, grade, and series-loop gates apply identically.
- Client-facing visual language remains English-Latin, secular, evidence-bounded, he/him, and has no visible AI label.

---

## v2 structural pipeline

```text
Research → Script → Voice → Timeline → Hero Open
         → ASSET / B-ROLL: live per-beat clips + manifest
         → Score → Film: kinetic type + hero clock over clips
         → Motion QC + technical QC → Fresh Eyes (≥8.5) → Publish
```

## v2 acceptance test

- [ ] Every beat background is a moving clip or the full moving 2.5D fallback; no frozen frame exceeds 2 seconds.
- [ ] Each beat is a distinct shot under one coherent grade and palette.
- [ ] The Living Clock is prominent and lands its final value on the CTA frame.
- [ ] Numbers pop-land and words reveal per-word; no static template panel carries the message.
- [ ] CTA has an owned reply prompt and series-loop tease in the final two seconds.
- [ ] Citations clear the platform UI zone; the clock clears the icon rail.
- [ ] Hindi uses Roman-Hinglish on screen; no visible AI label; Maddy = he/him.

**Any NO = rebuild that piece.**
