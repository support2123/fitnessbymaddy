# LESSONS LOG — engine ka memory
*Har entry = kya toota · kya fix hua · kaunsa rule bana. Naya episode shuru karne se pehle pichhli 2 entries padho.*

---

## EP-05 · GRIP — 2026-09-24 (portable engine ka pehla episode)

**Context:** Mac studio ke bina, ek CPU box pe poora reel banaya — Remotion/Chromium/GPU ke bina, API key ke bina.

### Kya toota / kya seekha
1. **Remotion ka har component port kiya ja sakta hai.** `FbmFilmKit.tsx` → `filmlib.py` me 1:1 — `Head/Cite/Chapter/Kicker/StatStamp/RollCounter/ItalicClaim/HonestyChip/CTABlock/CredThird/ContentsCard` + `coldOpen`. Layout law constants bhi transferable hain (`bottom:400 / 330 / top:46 / cred 250`). **Rule banaya:** films aur kit ka ek hi grammar do jagah maintain hoga, warna lesson pura nahi hota.
2. **Collision QA ko render ke BAAD nahi, preview-time pe karo.** `render_film.py --preview <t>` se ek frame ~2 s me nikalta hai. Isi se 3 collision pakde (headline vs caption chip, steps vs headline, ladder vs claim) — full render se pehle.
3. **m02 me "1,000 rows" wala idea rejected** — RollCounter ko 139,691 pe rukna chahiye tha, 139,000 pe nahi (premature value = kit ka law). Step=1 use karo jab exact number bol raha ho.
4. **16% slam ko cold-open banaya** — film ka best moment frame 0 pe. Hook latency 10/10. **Rule:** har episode me pehle ye decide karo, ki "best moment" kya hai, phir use `cold_open_t(t, SRC, 0.80)` me daalo.
5. **Delivery encode CRF 20** — CRF 17 + film grain = 107 MB file (publish se pehle). Grain-friendly CRF 20-22 + `-g 60` = 33-44 MB, quality wahi. **Rule:** grain wale film ko CRF 17 pe master karo, par **upload CRF 20** karo.
6. **Surgical fix ka sasta rasta:** design fix sirf us window ka re-render + **keyframe-aligned `-c copy` concat** splice. 8-16 s window ka render = 65 s; 62-71.7 s = 105 s. Do fix, ~3 min, poora re-render (~10 min) nahi. **Rule:** `-g 60` rakho taaki splice boundaries 2 s grid pe clean milen.
7. **CTA stack ka order kit me hi defined hai** — headline → italic → question → ASK → pill → cred. Mere pehle version ne pill ko ask se upar rakh diya tha; audit ne pakda. **Rule:** CTA edit karne se pehle kit ka `CTABlock` kholo, dimaag se nahi likho.
8. **Offline VO mode zaroori hai.** `gen_vo_scratch.py` (piper) se timeline/film/score bina key ke ban gaye. Delivery me clone zaroori — auditor ne ise "production honesty note" me likhwaya.

### Numbers (EP-05 baseline — agli baar isse compare karo)
| Metric | Value |
|---|---|
| Runtime | 71.83 s (9 segments + 3.5 s tail) |
| Speech | 6.88 · 5.78 · 9.57 · 5.92 · 6.35 · 7.43 · 7.65 · 8.74 · 4.71 s |
| Renders | full 2152 f @ ~2.5-4 fps · 2 surgical windows |
| QC | −14.0 LUFS · −1.0 dBTP · sterile PASS · 3 sheets · 8 full-res frames |
| Fresh eyes | 8.1/10 · SHIP WITH TWEAKS · 2 fix ship se pehle |
| Files | film 107 MB → delivery 34 MB → publish 33.8 MB |

---

## EP-06 · WATER — "The Tax" (24 Sep 2026 · first episode built from the DECODER OS curriculum)
Topic `P04_WATER-02` · 116.83 s · 3505 frames · 10 beats · ONE CLOCK = THE PULSE (60 -> 69 -> 60 bpm)

### What was new
1. **First episode driven by the curriculum, not a hunch.** The 6-beat DECODE was widened to 10 beats (contents, hook, system, datum, honesty, myth+danger, proof, protocol, receipt, handoff). The extra beats are what made it cinematic: the *honesty* beat and the *receipt* beat are the brand's differentiators, not filler.
2. **The clock became content, not decoration.** The on-screen bpm HUD, the beating dot, the scrolling ECG and the score's heartbeat all run off one closed-form function (`pulse()` in `film_water.py`, mirrored in `bed_water.py`). When the film says "+3 bpm per 1%", the viewer *watches* the rate change by exactly that. Lesson: when the datum is a rate, make the rate visible — a static stat card wastes the strongest beat.
3. **Corrections shipped against our own genre.** The 2%-rule (lab vs road) and 8×8 (1945 line read halfway) are the exact kind of claim a hydration brand would sell. Shipping the correction, with sources, is the moat — and it is *free reach* because it is the most quotable line in the film.
4. **VOICE v2.** One broadcast chain in both VO tools (measured: presence +12.5 %, air +8.8 %, mud flat, peaks limited). Documented in `docs/VOICE-UPGRADE.md`.
5. **`swap_voice.sh`** — the clone swap is now one command with a hard gate at the front (refuses to run without a key instead of shipping a half-swapped episode).

### What broke (and the rule each break created)
| Break | Rule |
|---|---|
| `honesty_chip` leaked an empty cyan box after fading — it faded the *text* but not the *border* | **Composite a whole component at one opacity.** Never fade a component's insides. Fixed in filmlib, applies to every episode. |
| `stat_stamp` label overlapped the number for top-anchored stamps (m01) | Anchor-aware labels (lt/ct/rt). If a stamp is anchored `rt`, its label is too. |
| Chips were written to fade after ~4.5 s while the VO kept talking for 8 s (m04/m05/m08) | **Time overlays against the VO line, not against the beat window.** A chip that dies mid-sentence reads as a bug. |
| `≈` renders badly in Anton | Keep maths symbols out of Anton display text; put "about" in the VO and a bare number on the frame. |
| `drip()` got two `x` arguments (signature collision) — it only crashed at 70.5 s, i.e. *after* the long render had already died at that same frame | **Preview every beat boundary before a long render**, not just the pretty frames. A 1.8 s preview sweep (9 frames) would have caught it before a 25-minute render. |
| The concat splice + delivery pass left the container at **29.97 fps** although every frame was rendered at exactly 1/30 s | Delivery re-encodes must pin the rate: `-r 30` on the crf20 pass (`run_episode.sh` now does). Instagram accepts both, but the spec says 30. |

### Numbers to carry forward
- 10 beats / 116.83 s is the new cinematic template. 1 beat ≈ 11.7 s average — the honesty chip needs **6.5–7.5 s of screen time** to be read at 1080×1920.
- The datum beat wants: kicker + chart + stat + ECG trace + HUD. Five elements, none colliding — keep the chart at y 760-1060 and the HUD at y 1250 when a trace is on screen.
- Bed: heartbeat windows of 4 s stepping through the bpm curve is enough — the ear locks to the period, not the phase.

### Open on this episode
- Scratch voice (piper) is still the shipped audio — swap with `swap_voice.sh` when the clone lands (key + voice id).
- CTA tail shot uses a gold-grade of `glass_meal.jpg`; `hands_water.jpg` was blocked by the per-turn image budget and is a one-line swap when generated.

### Rebuild addendum · 24 Sep 2026 (snapshot restore + three engine defects)

- **Artifacts are regenerable, not sacred.** A workspace restore dropped this episode's binaries
  (PUBLISH, mix, covers, sources, docs) and kept only `qc/`. Rebuild cost: about an hour. Keep
  `PRUNE-NOTES.txt` and `run_episode.sh` current, and check the publish file exists before
  promising a preview.
- **`binpaths.probe()` must never leak ffmpeg stderr.** On ffmpeg-only boxes newer builds print
  extra info lines ("Guessed Channel Layout") before `Duration`, so callers doing
  `float(probe(...).splitlines()[0])` crashed. It now regex-parses `Duration` and always returns
  `seconds\nbitrate` — same shape for every caller, in every environment.
- **`filmlib.stat_stamp` label alignment.** It tested `anchor.endswith("r"/"c")`, which is False for
  every top anchor ("rt"/"ct" end in "t"), so right and centre stamps pushed their label off the
  right edge of the frame. Alignment now follows `anchor[0]`.
- **Overlay opacity is per beat.** A single top-level `o = win(tt, B["m01"], ...)` silently zeroed
  every cite chip and the pulse HUD from beat 2 to the end of the film. Nothing about it looks
  broken in code review; it looks broken on screen.
- **Layout law, restated:** helper blocks (protocol rows, stat labels, traces) must start below the
  kicker/head block. m07's rows at y=300 sat under the headline — rows now start at ROW0=700 and
  the receipt stamp at 1120.
- **Why the boundary preview pass earns its keep.** All three defects were invisible on a 300 px
  contact sheet and obvious in a 1:1 crop. The pass must now include one full-res crop of the HUD
  band and one of a stat stamp, not just a scaled sheet. Original drip()/ripple() collision was the
  same story — it surfaced at frame 2041 of a 3505-frame render.
- **The clock held.** After the rebuild the mix re-hit −14.0 LUFS / LRA 1.7 / −1.0 dBTP and the HUD
  reads 60 → 63 → 69 bpm across the datum beat, then settles to 60. One clock, one story.

### Engine notes from the same rebuild (post-render)

- **`binpaths.probe()` is now request-shaped.** Three callers wanted three different things from
  one fallback path: durations (`gen_vo_scratch`), codec names (`publish_ig`'s h264-only guard) and
  tags (sterile verification). It now answers in kind: duration family → `seconds\nbitrate`,
  `stream=...` → one value per line in the requested order, `tags` → `key=value` lines or empty.
  Signatures unchanged, so nothing downstream had to move.
- **True peak, not sample peak.** The mix's two-pass loudnorm now targets **TP −1.3 dBTP** instead
  of −1.0, because the AAC encode adds roughly 0.1 dB of true-peak overshoot after the limiter.
  Integrated loudness is unaffected (−14.0 LUFS exactly), and the *delivered* master measures
  −1.2 dBTP, which is what the sealed rule actually asks for (≤ −1.0 dBTP). The old target let the
  final file measure −0.9 dBTP even though the mix printed −1.0.
- **Delivery order that worked:** mix → mux → crf20 delivery (`-r 30` pinned) → qc_sweep → publish_ig.
  Render was 3494/3494 frames in 1693 s; mux + delivery ≈ 4 min; QC + sterile publish ≈ 1 min.

### Snapshot cap is the real cause of the vanishing files (24 Sep 2026)

- Every "file not found" on a built video traced back to ONE thing: the workspace snapshot
  is best-effort capped near 128 MB, and this repo was already at ~121 to 137 MB depending
  on what was on disk. The two 1080x1920 masters alone are 95 MB of that.
- Failure mode: any large new artifact (a 7 MB viewer copy, a 175 MB render, a 13 MB preview
  set) pushes the total over the cap, the turn-end snapshot does not land, and the next
  restore silently reverts to an older state. Masters from earlier snapshots survive; the
  newest files are the ones that vanish. It looks like "the preview broke" from the outside.
- Rules now in force:
  · keep the workspace at or below ~120 MB before adding anything (du -sh --exclude=.cache)
  · rebuildable intermediates (render.mp4, reel.mp4, wav stems) are pruned in the same turn
    they are used — the publish master is the only heavy artifact that must persist
  · viewers are built by `python3 tools/engine/make_viewer.py episodes/<EP>` → <EP>-VIEW.mp4
    (480x854, ~2.5 MB) and <EP>-PLAYER.html (video + poster embedded, ~2 MB). The HTML player
    has no external file references, so it cannot 404 in any viewer.
  · QC sheets are stored as JPEG q86 (4.5 MB saved across both episodes, no visible loss).
- Also true, and worth remembering: /tmp does NOT survive a restore either. Anything worth
  keeping goes under /home/user, and anything large goes only as long as it is needed.

### Hindi narration cut — what the pipeline needed (24 Sep 2026)

- **Text stays English, voice becomes Hindi.** The film module never changed: every overlay string
  is baked in English, and only `segments.json` (the VO source) was swapped. One file decides
  language. That is the cheapest possible localisation and it should stay that way.
- **Hindi needs ~25% more time than English.** Same script: 113 s English vs 144.5 s Hindi at
  natural pace. A straight read gives a 2:21 reel, outside the 1:40 to 2:00 brief.
- **Per-beat pacing fit beats global speed-up.** `tools/engine/chain_vo.py` measures each take,
  then applies atempo (pitch-preserving) only up to a cap (default 1.25, used 1.28) and never past
  that beat's choreography minimum (`MIN[id]`: chips must hold their read, the CTA must not rush).
  Result: 2:01 reel with the close still breathing, because m09 only needed x1.09.
- **Duration-aware overlays.** Hindi m05 is shorter than the English one, so the film now derives
  the danger turn from the beat duration: `a = s0 + clamp(dur - 7.6, 4.6, 9.2)`, and when the beat
  is tight the "14" rides inside the chip headline instead of getting its own stamp. The picture
  follows the audio, always — beats are measured, never assumed.
- **One chain, two voice sources.** `chain_vo.py` imports `CHAIN`/`TRIM` straight out of
  `gen_vo_scratch.py`, so platform-TTS takes and the offline scratch voice cannot drift tonally.
- **Voice selection workflow that worked:** audition a pair with a line from the actual script
  (the "14 athletes" beat), let the user pick, then generate all ten beats with that one voice id.
  The audition doubles as a preview of the delivered tone.

### Fact-check pass caught a spoken-year error (24 Sep 2026)

- The Hindi VO said "nineteen fifty" where the source (Valtin 2002) says **1945**. On-screen data was
  right, the narration was wrong — exactly the kind of slip a fact-check document exists to catch.
- Lesson: **numbers spoken in a language you are not reading line-by-line need their own lint pass.**
  The English cut was built from a verified script; the Hindi cut was adapted, and the adaptation is
  where the error entered. Add a spoken-number audit to the gauntlet: every year, dose, volume and
  percentage in a VO take gets read back against the citation library before the mix.
- Fix cost: one regenerated beat, then VO → timeline → score → mix → render → QC (~35 min including
  the render). Cheap, because the pipeline is one command per stage.
- Also fixed in the same pass: the m02 cite chip now names Mitchell 1945 for the 73% brain-water
  figure, so the chip and the citation library resolve 1:1.

### The delivery pass was eating the quality (24 Sep 2026)

- The chain was: render at **crf 17** → mux → **delivery re-encode at crf 20** → publish (copy).
  So the shipped master was a *second* encode, ~4.4 Mbps, one generation away from the render.
- For an Instagram master that is backwards. The correct chain is ONE lossy encode at the highest
  quality the pipeline can afford, then only stream-copies after it:
    render (crf 15, preset slow, env-overridable) -> mux with the audio **copied** out of the
    shipped master -> publish_ig strips metadata with `-c copy` -> done.
- `render_film.py` now takes `FBM_RENDER_CRF` and `FBM_RENDER_PRESET`, so a high-quality master is
  an env var, not a code change: `FBM_RENDER_CRF=15 FBM_RENDER_PRESET=slow python3 …`
- Delivery note for the file itself: Instagram's own guidance is H.264 MP4, 1080 wide, 30 fps,
  ≥10 Mbps for best fidelity. The top master now sits around that band instead of half of it.
- Cost: ~40 min of render and ~250 MB of scratch disk (written to /tmp, never snapshotted).

### Serving beats embedding for big files (24 Sep 2026)

- A 193 MB master cannot live in the workspace (snapshot budget ~128 MB) and should not be embedded
  as a data URI (the viewer would choke). It lives in `~/.cache/` (excluded from snapshots) and is
  **served** by `tools/engine/serve_episode.py`.
- The page pairs the two things the user actually asked for: **watch here** (player streaming the
  master inline, HTTP range) and **download here** (buttons that are real MP4 responses with
  `Content-Disposition: attachment`). Content-Disposition is toggled by `?dl=1`, which is what makes
  the same URL work for both `<video src>` and a save-to-disk click.
- Verified end to end: a full 192.8 MB pull through the server hashes identical to the source file,
  and a mid-file range request returns 206 with the right byte window — so a dropped download resumes.
