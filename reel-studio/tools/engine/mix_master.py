#!/usr/bin/env python3
"""FBM ENGINE · mix + master, doctrine edition.

Usage: mix_master.py <episode_dir> [out.m4a]

The bed is manually ducked from the measured VO timeline, not by a live compressor.
Each spoken window receives a 150 ms attack into a -6.5 dB bed reduction and a 400 ms
release back to unity. This prevents audible pumping while preserving full music only
in genuine voice gaps. The result is loudness-normalized to -14 LUFS / -1 dBTP and
encoded as 48 kHz 320 kbps AAC.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

FF = binpaths.ffmpeg()
SAMPLE_RATE = 48000
DUCK_GAIN = 10 ** (-6.5 / 20)
ATTACK = 0.150
RELEASE = 0.400


def duration_seconds(path: pathlib.Path) -> float:
    text = binpaths.probe(str(path), "format=duration")
    try:
        return float(text.strip().splitlines()[0])
    except (ValueError, IndexError) as exc:
        raise SystemExit(f"could not read duration for {path}: {text}") from exc


def envelope(total: float, windows: list[tuple[float, float]]) -> np.ndarray:
    n = max(1, int(np.ceil(total * SAMPLE_RATE)))
    gain = np.ones(n, dtype=np.float32)
    for start, end in windows:
        a0 = max(0, int((start - ATTACK) * SAMPLE_RATE))
        a1 = min(n, int(start * SAMPLE_RATE))
        h0 = a1
        h1 = min(n, int(end * SAMPLE_RATE))
        r0 = h1
        r1 = min(n, int((end + RELEASE) * SAMPLE_RATE))
        if a1 > a0:
            attack = np.linspace(1.0, DUCK_GAIN, a1 - a0, endpoint=False, dtype=np.float32)
            gain[a0:a1] = np.minimum(gain[a0:a1], attack)
        if h1 > h0:
            gain[h0:h1] = np.minimum(gain[h0:h1], DUCK_GAIN)
        if r1 > r0:
            release = np.linspace(DUCK_GAIN, 1.0, r1 - r0, endpoint=False, dtype=np.float32)
            gain[r0:r1] = np.minimum(gain[r0:r1], release)
    return gain


def write_envelope(path: pathlib.Path, values: np.ndarray) -> None:
    stereo = np.column_stack((values, values))
    pcm = np.clip(stereo * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm.tobytes())


def main() -> None:
    ep = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ep / "mix.m4a"
    timeline_path = ep / "timeline.json"
    if not timeline_path.exists():
        raise SystemExit("timeline.json is required: manual ducking follows measured voice windows")
    timeline = json.loads(timeline_path.read_text())
    windows = [tuple(bounds) for bounds in timeline.get("seg", {}).values()]
    if not windows:
        raise SystemExit("timeline.json has no voice windows")
    bed = ep / "bed.wav"
    vo = ep / "vo.wav"
    if not bed.exists() or not vo.exists():
        raise SystemExit("bed.wav and vo.wav are both required")

    total = max(float(timeline["total"]), duration_seconds(bed), duration_seconds(vo))
    env = ep / ".duck-envelope.wav"
    premix = ep / ".premix.wav"
    write_envelope(env, envelope(total, windows))

    try:
        subprocess.run([
            FF, "-y", "-v", "error", "-i", str(bed), "-i", str(env), "-i", str(vo),
            "-filter_complex",
            "[0:a]aresample=48000,aformat=channel_layouts=stereo[music];"
            "[1:a]aresample=48000,aformat=channel_layouts=stereo[envelope];"
            "[music][envelope]amultiply[ducked];"
            "[2:a]aresample=48000,aformat=channel_layouts=stereo[voice];"
            "[ducked][voice]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.94[mix]",
            "-map", "[mix]", "-ar", str(SAMPLE_RATE), "-ac", "2", str(premix)
        ], check=True)

        measure = subprocess.run([
            FF, "-hide_banner", "-i", str(premix), "-af",
            "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"
        ], capture_output=True, text=True, check=False)
        match = re.search(r"\{[^{}]*\"input_i\".*?\}", measure.stderr, re.S)
        if not match:
            raise SystemExit("loudnorm measurement failed:\n" + measure.stderr[-1500:])
        data = json.loads(match.group(0))
        loudnorm = (
            f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={data['input_i']}:measured_TP={data['input_tp']}:"
            f"measured_LRA={data['input_lra']}:measured_thresh={data['input_thresh']}:"
            f"offset={data['target_offset']}:linear=true"
        )
        # AAC can overshoot an exact -1 dBTP target by a tenth. A transparent final
        # ceiling leaves a small deterministic margin. `level=0` is essential: without
        # it alimiter normalizes its own output back to full scale after limiting.
        subprocess.run([
            FF, "-y", "-v", "error", "-i", str(premix), "-af", loudnorm + ",alimiter=limit=0.88:level=0",
            "-c:a", "aac", "-b:a", "320k", "-ar", str(SAMPLE_RATE), "-ac", "2", str(out)
        ], check=True)
    finally:
        for temporary in (env, premix):
            if temporary.exists():
                temporary.unlink()

    verify = subprocess.run([FF, "-hide_banner", "-i", str(out), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    lines = [line.strip() for line in verify.stderr.strip().splitlines()[-24:] if re.search(r"(I|LRA|Peak|TP):", line)]
    print("--- manual ducking ---")
    print(f"timeline windows: {len(windows)} · bed reduction: -6.5 dB · attack: 150 ms · release: 400 ms")
    print("--- loudness verify ---")
    print("\n".join(lines[-6:]))
    print("OUT:", out)


if __name__ == "__main__":
    main()
