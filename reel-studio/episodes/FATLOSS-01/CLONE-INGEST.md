# Clone-3 ingest protocol — FATLOSS-01

When the voice-clone delivery is available, import it as files named exactly `m00.wav` through `m08.wav` into `VOICE/` and perform this gate before editing:

1. `ffprobe`: WAV readable; record codec, sample rate, channel layout, bit depth and exact duration.
2. Compare segment durations with `VOICE/SEGMENTS.txt`. Do not speed or pitch shift to force alignment.
3. Generate two independent speech-to-text transcripts; compare each against `SCRIPT-FINAL.md` per segment. Flag any changed word, missed phrase, clipped onset, or malformed number.
4. Listen for plosives, click/pop, codec artifacts, harsh sibilance, and room changes. Only repair processing allowed: RX-style de-noise/de-plosive/de-ess, HPF 80 Hz, gentle presence EQ, and 3:1 compression.
5. Render a timing check at native voice speed. Target full master ~116 s; tighten inter-segment breath only if required. Never exceed 118 s and never exceed 120 s.
6. Store `VOICE-INGEST-QC.md` with checksums and outcome before producing the final publish master.

**Voice rule:** User-provided Clone-3 only. Do not use AI narration, a generic voice, or voice conversion as a substitute.
