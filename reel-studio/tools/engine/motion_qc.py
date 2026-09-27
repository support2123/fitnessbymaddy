#!/usr/bin/env python3
"""FBM LIVE MOTION QC — reject motion posters before a film can ship.

Checks every approved asset-manifest row for:
  1. a near-static window longer than two seconds (Farnebäck optical flow),
  2. freeze-frame tail padding,
  3. a reused background presented as a different beat (pHash), and
  4. grade drift warnings across beat clips.

The input assets are tested rather than the final composite so animated typography,
score, and grain cannot hide a frozen background. A failure returns work to ASSET/B-ROLL.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

import binpaths
from motion_manifest import ManifestError, load_manifest, validate

try:
    import cv2  # type: ignore
except ImportError:  # deliberate hard gate unless an operator explicitly requests diagnostic fallback
    cv2 = None

SAMPLE_FPS = 2
SAMPLE_W, SAMPLE_H = 96, 170


def video_spec(path: Path) -> tuple[int | None, int | None, float | None]:
    """Read source dimensions/fps without relying on a separately installed ffprobe."""
    proc = subprocess.run([binpaths.ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    text = proc.stderr
    size = re.search(r"Video:[^\n]*?(\d{2,5})x(\d{2,5})", text)
    rate = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
    return (int(size.group(1)) if size else None,
            int(size.group(2)) if size else None,
            float(rate.group(1)) if rate else None)


def decode_frames(path: Path, duration: float, loop: bool) -> np.ndarray:
    cmd = [binpaths.ffmpeg(), "-v", "error", "-nostdin"]
    if loop:
        cmd += ["-stream_loop", "-1"]
    cmd += ["-i", str(path), "-t", f"{duration:.3f}", "-an", "-vf",
            f"fps={SAMPLE_FPS},scale={SAMPLE_W}:{SAMPLE_H}:force_original_aspect_ratio=increase,crop={SAMPLE_W}:{SAMPLE_H}",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip() or "ffmpeg decode failed")
    unit = SAMPLE_W * SAMPLE_H * 3
    count = len(proc.stdout) // unit
    if count < 2:
        raise RuntimeError("asset decoded fewer than two motion samples")
    return np.frombuffer(proc.stdout[:count * unit], np.uint8).reshape(count, SAMPLE_H, SAMPLE_W, 3)


def grey(frame: np.ndarray) -> np.ndarray:
    if cv2 is not None:
        return cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    return np.dot(frame[..., :3], [0.299, 0.587, 0.114]).astype(np.uint8)


def flow_energy(frames: np.ndarray, allow_frame_diff: bool) -> tuple[list[float], str]:
    if cv2 is None and not allow_frame_diff:
        raise RuntimeError("OpenCV is required for production optical-flow QC; run bootstrap_env.sh")
    values: list[float] = []
    previous = grey(frames[0])
    method = "farneback_optical_flow" if cv2 is not None else "frame_difference_diagnostic"
    diagonal = math.hypot(SAMPLE_W, SAMPLE_H)
    for frame in frames[1:]:
        current = grey(frame)
        if cv2 is not None:
            flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            magnitude = cv2.magnitude(flow[..., 0], flow[..., 1])
            values.append(float(np.mean(magnitude) / diagonal))
        else:
            values.append(float(np.mean(np.abs(current.astype(np.float32) - previous.astype(np.float32))) / 255.0))
        previous = current
    return values, method


def dct_matrix(n: int) -> np.ndarray:
    x = np.arange(n)
    k = np.arange(n)[:, None]
    matrix = np.cos(np.pi * (2 * x + 1) * k / (2 * n))
    matrix[0] *= math.sqrt(1 / n)
    matrix[1:] *= math.sqrt(2 / n)
    return matrix


def phash(frame: np.ndarray) -> np.ndarray:
    image = Image.fromarray(frame).convert("L").resize((32, 32), Image.Resampling.LANCZOS)
    arr = np.asarray(image, dtype=np.float32)
    basis = dct_matrix(32)
    coeff = basis @ arr @ basis.T
    low = coeff[:8, :8]
    median = np.median(low.flatten()[1:])
    return (low > median).reshape(-1)


def color_metrics(frames: np.ndarray) -> tuple[float, float]:
    arr = frames.astype(np.float32) / 255.0
    luma = arr[..., 0] * .2126 + arr[..., 1] * .7152 + arr[..., 2] * .0722
    chroma = np.std(arr, axis=-1)
    return float(np.mean(luma)), float(np.mean(chroma))


def window_means(values: list[float], window_frames: int) -> list[float]:
    if not values:
        return [0.0]
    if len(values) <= window_frames:
        return [float(np.mean(values))]
    return [float(np.mean(values[i:i + window_frames])) for i in range(0, len(values) - window_frames + 1)]


def evaluate(ep: Path, allow_frame_diff: bool) -> dict[str, Any]:
    manifest_errors = validate(ep, strict=True)
    manifest = load_manifest(ep)
    policy = manifest["quality_policy"]
    report: dict[str, Any] = {
        "schema_version": "fbm.live-motion-qc/v1",
        "episode": ep.name,
        "sample_fps": SAMPLE_FPS,
        "method": "farneback_optical_flow" if cv2 is not None else "frame_difference_diagnostic",
        "checks": [],
        "failures": list(manifest_errors),
        "warnings": [],
        "result": "BLOCKED",
    }
    if manifest_errors:
        return report

    static_s = float(policy["static_window_max_s"])
    min_energy = float(policy["motion_energy_min"])
    tail_limit = float(policy["freeze_tail_max_s"])
    phash_min = int(policy["distinct_shot_phash_min_distance"])
    luma_warn = float(policy["grade_luma_delta_warn"])
    chroma_warn = float(policy["grade_chroma_delta_warn"])
    hashes: dict[str, np.ndarray] = {}
    grades: dict[str, tuple[float, float]] = {}
    win_frames = max(1, int(round(static_s * SAMPLE_FPS)) - 1)

    for row in manifest["beats"]:
        beat_id = str(row["id"])
        duration = float(row["end_s"]) - float(row["start_s"])
        path = ep / str(row["clip_file"])
        entry: dict[str, Any] = {"id": beat_id, "clip_file": str(row["clip_file"]), "duration_s": duration}
        try:
            width, height, fps = video_spec(path)
            entry.update({"source_width": width, "source_height": height, "source_fps": fps})
            if (width, height) != (1080, 1920):
                report["failures"].append(f"{beat_id}: source clip must be 1080x1920, got {width}x{height}")
            if fps is None or abs(fps - 30.0) > .05:
                report["failures"].append(f"{beat_id}: source clip must be 30fps, got {fps}")
            frames = decode_frames(path, duration, bool(row["loop"]))
            values, method = flow_energy(frames, allow_frame_diff)
            minima = min(window_means(values, win_frames))
            tail_run = 0
            for value in reversed(values):
                if value < min_energy * .25:
                    tail_run += 1
                else:
                    break
            tail_s = tail_run / SAMPLE_FPS
            entry.update({
                "samples": int(len(frames)), "motion_method": method,
                "motion_energy_mean": round(float(np.mean(values)), 6),
                "motion_energy_min_2s_window": round(minima, 6),
                "freeze_tail_s": round(tail_s, 3),
            })
            if minima < min_energy:
                report["failures"].append(
                    f"{beat_id}: near-static {static_s:.1f}s window ({minima:.6f} < {min_energy:.6f})"
                )
            if tail_s > tail_limit:
                report["failures"].append(
                    f"{beat_id}: freeze-frame tail {tail_s:.2f}s exceeds {tail_limit:.2f}s"
                )
            hashes[beat_id] = phash(frames[len(frames) // 2])
            grades[beat_id] = color_metrics(frames)
        except (RuntimeError, OSError) as exc:
            report["failures"].append(f"{beat_id}: cannot inspect motion asset: {exc}")
        report["checks"].append(entry)

    ids = list(hashes)
    for i, left in enumerate(ids):
        for right in ids[i + 1:]:
            distance = int(np.count_nonzero(hashes[left] != hashes[right]))
            if distance < phash_min:
                report["failures"].append(
                    f"{left}/{right}: pHash distance {distance} < {phash_min}; distinct-shot law failed"
                )
    if grades:
        reference_id = ids[0]
        ref_luma, ref_chroma = grades[reference_id]
        for beat_id, (luma, chroma) in grades.items():
            if abs(luma - ref_luma) > luma_warn or abs(chroma - ref_chroma) > chroma_warn:
                report["warnings"].append(
                    f"{beat_id}: grade drift vs {reference_id} (Δluma={abs(luma-ref_luma):.3f}, Δchroma={abs(chroma-ref_chroma):.3f})"
                )
    report["result"] = "PASS" if not report["failures"] else "BLOCKED"
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="FBM live-motion asset QC")
    ap.add_argument("episode_dir")
    ap.add_argument("--allow-frame-diff", action="store_true", help="diagnostic only; production requires OpenCV optical flow")
    ap.add_argument("--out", default="", help="default: <episode>/qc/MOTION-QC.json")
    args = ap.parse_args()
    ep = Path(args.episode_dir).resolve()
    try:
        report = evaluate(ep, args.allow_frame_diff)
    except ManifestError as exc:
        report = {"episode": ep.name, "result": "BLOCKED", "failures": [str(exc)], "warnings": [], "checks": []}
    output = Path(args.out).resolve() if args.out else ep / "qc" / "MOTION-QC.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"MOTION QC · {ep.name} · {report['result']} · {output}")
    for line in report.get("failures", []):
        print("  [FAIL]", line)
    for line in report.get("warnings", []):
        print("  [WARN]", line)
    if report["result"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
