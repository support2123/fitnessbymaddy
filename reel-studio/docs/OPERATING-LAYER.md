# FBM Reel Studio — locked operating layer

This studio is the canonical production workspace for FitnessByMaddy reels. It is separate from the static marketing site at the repository root. Nothing here deploys, embeds on the website, or posts to social automatically.

## Precedence

1. `doctrine/source/00-MASTER-SPEC.md`
2. `doctrine/source/DOCTRINE-01-HOOK-SCRIPT.md`
3. `doctrine/source/DOCTRINE-02-OPENING-IMAGE.md`
4. `doctrine/source/DOCTRINE-03-DESIGN-MOTION.md`
5. `config/studio.json`
6. Legacy DECODER OS material in `docs/`, `content/`, and `engine/`

When an earlier document conflicts with the operating layer, the higher document wins. In practice this changes the legacy system in five ways: every reel opens on a cover-locked hero rather than black or a contents card; runtime is routed by depth; hooks are balanced between named and teased; the Living Clock is mandatory; Fresh Eyes must reach 8.5 or above.

## The 10 strikes

| Strike | Owner / gate | Required output |
| --- | --- | --- |
| 1. Request routing | `tools/ops/intake.py` | `request.json`, duration tier, slate decision |
| 2. Research | research gauntlet + Maddy approval | `research.md`, locked citation spine |
| 3. Hook | Hook doctrine | name/tease decision, archetype, on-screen and spoken hook |
| 4. Script | script gauntlet + Viral 6/6 | `SCRIPT-FINAL.md`, `script-checklist.json` |
| 5. Voice | cloned voice + verifier | verified segmented WAVs |
| 6. Timeline | audio leads picture | `timeline.json` |
| 6.5. Hero open | `tools/ops/hero_open.py` | concept, prompt, locked hero still, cover confirmation |
| 7. Score + film | Living Clock and design system | final picture plus mix |
| 8. QC | technical and world-class frame audit | QC report, reviewed contact sheets |
| 9. Fresh Eyes | independent audit | score >= 8.5, criticals closed |
| 10. Publish | sterile container + upload pack | master, cover, caption, pinned comment, metrics handoff |

## Non-negotiable production law

- Frame zero is a full-bleed, cover-locked hero. Black opens and bullet-card opens are blocked.
- Every statistic is cited on the frame. A claim without a citation is cut, never softened.
- A Living Clock must be real to the story, drive environment plus telemetry plus trace, and reach its final value on the CTA frame.
- Fixed scientific constants pop in whole. Only the Living Clock rolls.
- The viewer gets one CTA, one owned-number reply prompt, and one line that opens the next reel.
- No visual ships outside the safe core or below the hard floor.
- Client-facing language remains English, secular, evidence-bounded, and free from hype or medical promises.

## Working media policy

The repository contains source code, specification, citations, scripts, manifests, audits, and compact review assets. High-resolution stills, raw takes, render intermediates, and upload masters live in local or external storage and are reproducible. This prevents workspace recovery limits from deleting the source of truth.
