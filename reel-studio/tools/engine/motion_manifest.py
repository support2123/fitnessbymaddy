#!/usr/bin/env python3
"""FBM LIVE MOTION · asset manifest, generation brief, and hard schema gate.

This tool is deliberately provider-neutral. It produces the exact shot contract that
an operator can execute in Runway, Kling, Veo, Luma, Sora, Pika, Midjourney Video,
real-stock, or a 3D package. It never pretends that a vendor UI is an API.

Usage:
  python3 tools/engine/motion_manifest.py episodes/EP plan
  python3 tools/engine/motion_manifest.py episodes/EP validate --strict
  python3 tools/engine/motion_manifest.py episodes/EP generation-pack

`plan` is allowed to create placeholder clip paths. `validate --strict` is the
production gate: every row must point to a real MP4 and must preserve the continuity
contract. Motion pixel quality is checked by motion_qc.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = "fbm.live-motion/v1"
MANIFEST = "motion-manifest.json"
PACK = "MOTION-GENERATION-PACK.md"
PROVIDERS = {
    "runway_gen4": "Runway Gen-4 / Gen-4 Turbo — controlled image-to-video and reference-led hero motion",
    "kling_2_5": "Kling 2.5 — physical lift motion, start/end frames, and constrained motion brush",
    "veo_3_1": "Veo 3.1 — cinematic atmosphere, volumetric light, and resolve shots; mute native audio",
    "sora_2": "Sora 2 — longer environment or abstract micro-sequences; not a likeness shortcut",
    "pika_2_2": "Pika 2.2 — keyframe transition and mechanism morphs",
    "luma_ray_3": "Luma Ray 3 — seamless ambient loops and restrained camera drift",
    "midjourney_v7_video": "Midjourney V7 video — style-locked animation of the approved still",
    "higgsfield": "Higgsfield — operator-authorized cinematic generation/export lane; use its current best controlled-motion mode",
    "hyperframe": "Hyperframe — operator-authorized direction/generation/export lane; use its current best controlled-motion mode",
    "open_director": "Open Director — operator-authorized direction/generation/export lane; use its current best controlled-motion mode",
    "artgrid_stock": "Artgrid / approved licensed stock — authentic human effort and gym texture",
    "storyblocks_stock": "Storyblocks / approved licensed stock — motion texture and utility b-roll",
    "pexels_stock": "Pexels / approved licensed stock — license-reviewed fast motion fill",
    "complete_anatomy_capture": "Complete Anatomy / BioDigital capture — animated anatomy only",
    "blender": "Blender / approved 3D pipeline — custom anatomy, particles, and camera work",
    "fallback_2_5d": "2.5D fallback — depth planes + displacement + particles + continuous push; never flat scale",
    "fusion_motion_graphics": "Resolve Fusion / After Effects / Remotion — data drawing over a moving ground",
}

# Segment labels are a production convenience; the supplied `beat` remains the source of truth.
BEAT_RULES: dict[str, dict[str, str]] = {
    "HOOK": {
        "kind": "hook_fear", "provider": "veo_3_1", "motion": "slow_push_in + drifting_dust",
        "subject": "ominous forward camera push", "grade": "desaturate -15%, cool toward graphite",
    },
    "TAX": {
        "kind": "myth_fear", "provider": "runway_gen4", "motion": "restrained_push + micro_drift",
        "subject": "single athlete or training object under tension", "grade": "graphite base, danger red only for emphasis",
    },
    "SYSTEM": {
        "kind": "mechanism", "provider": "complete_anatomy_capture", "motion": "rhythmic_physical_cycle + slow_orbit",
        "subject": "one body system visibly moving", "grade": "cyan science key, matched graphite blacks",
    },
    "TURN AND RECEIPT": {
        "kind": "proof_graph", "provider": "fusion_motion_graphics", "motion": "data_draw + continuous_graphite_drift",
        "subject": "one drawing line or proof marker", "grade": "bone type, cyan proof accent, no dead panel",
    },
    "PROTOCOL": {
        "kind": "protocol", "provider": "kling_2_5", "motion": "controlled_human_execution + slow_dolly",
        "subject": "one real lift or coaching movement", "grade": "Editorial Athletic; skin 62–70 IRE",
    },
    "CTA": {
        "kind": "cta_resolve", "provider": "runway_gen4", "motion": "confident_forward_push + restrained_gold_bloom",
        "subject": "one forward resolve subject", "grade": "gold resolve over graphite, steady camera",
    },
    "CTA FOLLOW": {
        "kind": "cta_resolve", "provider": "runway_gen4", "motion": "confident_forward_push + restrained_gold_bloom",
        "subject": "one forward resolve subject", "grade": "gold resolve over graphite, steady camera",
    },
}
DEFAULT_RULE = {
    "kind": "narrative", "provider": "runway_gen4", "motion": "slow_dolly + ambient_drift",
    "subject": "one moving visual subject", "grade": "Editorial Athletic house grade",
}


class ManifestError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ManifestError(message)


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing required file: {path}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {path}: {exc}")


def dump_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "shot"


def config() -> dict[str, Any]:
    return read_json(ROOT / "config" / "studio.json")


def source_segments(ep: Path) -> list[dict[str, Any]]:
    data = read_json(ep / "segments.json")
    items = data.get("segments")
    if not isinstance(items, list) or not items:
        fail("segments.json must contain a non-empty `segments` list")
    for row in items:
        if not isinstance(row, dict) or not row.get("id") or not row.get("text"):
            fail("every segments.json row needs `id` and `text`")
    return items


def timeline(ep: Path) -> tuple[dict[str, list[float]], float, int]:
    data = read_json(ep / "timeline.json")
    raw = data.get("seg", {})
    if not isinstance(raw, dict) or not raw:
        fail("timeline.json must contain measured `seg` windows; run assemble_vo.py first")
    cleaned: dict[str, list[float]] = {}
    for key, value in raw.items():
        if not isinstance(value, list) or len(value) != 2:
            fail(f"timeline segment {key!r} must be [start_s, end_s]")
        a, b = float(value[0]), float(value[1])
        if b <= a:
            fail(f"timeline segment {key!r} has a non-positive duration")
        cleaned[key] = [a, b]
    total = float(data.get("total", 0))
    fps = int(data.get("fps", 30))
    if total <= 0:
        fail("timeline.json needs a positive total")
    return cleaned, total, fps


def cache_key(prompt: str, seed: int, provider: str, source: str) -> str:
    material = f"{prompt}\n{seed}\n{provider}\n{source}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()[:20]


def motion_prompt(rule: dict[str, str], topic: str, beat_text: str) -> str:
    return (
        f"{rule['subject']}; story context: {topic}. Beat intention: {beat_text}. "
        f"Motion: {rule['motion']}. 9:16 vertical composition, 1080x1920, 30fps master. "
        "One dominant moving subject only; secondary dust or atmosphere at 20–40% strength. "
        "Camera moves in one slow monotonic direction, never whip-pans. Upper-left key light, "
        "4800–5200K white balance, graphite #101115 shadow floor, gold #D4A148 resolve, "
        "cyan #3FC6E0 science accents. No embedded captions, logos, UI, typography, watermarks, or audio. "
        "Generate at least one second longer than the required beat for editorial trim headroom."
    )


def plan(ep: Path, overwrite: bool = False) -> Path:
    manifest_path = ep / MANIFEST
    if manifest_path.exists() and not overwrite:
        print(f"PLAN EXISTS · {manifest_path} (use --overwrite to rebuild)")
        return manifest_path
    segments = source_segments(ep)
    windows, total, fps = timeline(ep)
    request = read_json(ep / "request.json") if (ep / "request.json").exists() else {}
    topic = str(request.get("topic") or ep.name.replace("-", " "))
    missing = [str(s["id"]) for s in segments if str(s["id"]) not in windows]
    if missing:
        fail("timeline is missing measured windows for: " + ", ".join(missing))

    # Background boundaries include speech gaps: the picture is live from frame zero to tail.
    starts = [windows[str(s["id"])][0] for s in segments]
    beats: list[dict[str, Any]] = []
    for index, seg in enumerate(segments):
        sid = str(seg["id"])
        source_beat = str(seg.get("beat", "")).upper()
        rule = dict(BEAT_RULES.get(source_beat, DEFAULT_RULE))
        start = 0.0 if index == 0 else starts[index]
        end = starts[index + 1] if index + 1 < len(starts) else total
        duration = round(end - start, 3)
        provider = rule["provider"]
        seed = 12031 + index * 101
        prompt = motion_prompt(rule, topic, str(seg["text"]))
        beat_id = identifier(sid)
        generated_duration = 10 if duration > 7.0 or rule["kind"] == "protocol" else 5
        beats.append({
            "id": beat_id,
            "segment_id": sid,
            "beat": rule["kind"],
            "start_s": round(start, 3),
            "end_s": round(end, 3),
            "clip_source": provider,
            "clip_file": f"assets/motion/{beat_id}_v1.mp4",
            "motion_type": rule["motion"],
            "loop": duration > generated_duration,
            "hero_subject": rule["subject"],
            "color_match_ref": True,
            "grade_note": rule["grade"],
            "generation": {
                "provider": provider,
                "mode": "image_to_video" if rule["kind"] not in {"proof_graph", "mechanism"} else "directed_motion",
                "prompt": prompt,
                "seed": seed,
                "reference_image": "hero/approved-reference.png",
                "style_reference": "hero/style-reference.png",
                "source_duration_s": generated_duration,
                "fps": 30,
                "resolution": "1080x1920",
                "native_audio": "discard",
                "cache_key": cache_key(prompt, seed, provider, "hero/approved-reference.png"),
            },
            "cover_lock": {
                "first_frame_reference": "hero/cover.png" if index == 0 else None,
                "first_frame_pixel_match": True if index == 0 else None,
                "static_hold_frames": 21 if index == 0 else None,
            },
        })

    payload: dict[str, Any] = {
        "schema_version": SCHEMA,
        "reel_id": ep.name.lower(),
        "fps": fps,
        "resolution": "1080x1920",
        "grade": "editorial_athletic",
        "lut": "assets/grade/editorial_athletic.cube",
        "continuity": {
            "seed_policy": "one locked seed per shot; append-only rerolls; never silently overwrite a chosen clip",
            "style_reference": "hero/style-reference.png",
            "subject_reference": "hero/approved-reference.png",
            "reference_lock": "one approved reference image and one style reference for every generated human shot",
            "white_balance_kelvin": [4800, 5200],
            "key_light": "upper_left",
            "camera_language": "slow push-ins and dollies only; no random whip pans or speed ramps",
            "grain": 0,
            "house_grade": "Editorial Athletic: matched blacks, matched contrast, graphite/gold/cyan palette",
        },
        "quality_policy": {
            "static_window_max_s": 2.0,
            "motion_energy_min": 0.0015,
            "freeze_tail_max_s": 0.5,
            "distinct_shot_phash_min_distance": 8,
            "grade_luma_delta_warn": 0.18,
            "grade_chroma_delta_warn": 0.22,
        },
        "beats": beats,
    }
    (ep / "assets" / "motion").mkdir(parents=True, exist_ok=True)
    dump_json(manifest_path, payload)
    generation_pack(ep, payload)
    print(f"MOTION PLAN · {len(beats)} live-shot rows -> {manifest_path}")
    print(f"NEXT: source or generate each MP4, then run validate --strict and motion_qc.py")
    return manifest_path


def load_manifest(ep: Path) -> dict[str, Any]:
    return read_json(ep / MANIFEST)


def _required(obj: dict[str, Any], key: str, where: str, errors: list[str]) -> Any:
    value = obj.get(key)
    if value in (None, "", [], {}):
        errors.append(f"{where}: missing `{key}`")
    return value


def validate(ep: Path, strict: bool) -> list[str]:
    data = load_manifest(ep)
    errors: list[str] = []
    if data.get("schema_version") != SCHEMA:
        errors.append(f"manifest schema must be {SCHEMA}")
    if int(data.get("fps", 0)) != 30:
        errors.append("manifest fps must be 30")
    if data.get("resolution") != "1080x1920":
        errors.append("manifest resolution must be 1080x1920")
    for key in ("grade", "lut", "continuity", "quality_policy", "beats"):
        _required(data, key, "manifest", errors)
    continuity = data.get("continuity", {})
    for key in ("style_reference", "subject_reference", "reference_lock", "key_light", "camera_language", "house_grade"):
        _required(continuity, key, "continuity", errors)
    if continuity.get("grain") != 0:
        errors.append("continuity.grain must be 0 for the live-motion house grade")
    if strict:
        for label, reference in (("style_reference", continuity.get("style_reference")), ("subject_reference", continuity.get("subject_reference"))):
            if reference and not (ep / str(reference)).is_file():
                errors.append(f"continuity: missing locked {label} {reference}")
    policy = data.get("quality_policy", {})
    if float(policy.get("static_window_max_s", 99)) > 2.0:
        errors.append("quality_policy.static_window_max_s must be <= 2.0")

    beats = data.get("beats", []) if isinstance(data.get("beats"), list) else []
    if not beats:
        errors.append("manifest needs at least one beat")
        return errors
    ids: set[str] = set()
    last_end = 0.0
    for index, row in enumerate(beats):
        where = f"beats[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{where} must be an object")
            continue
        rid = _required(row, "id", where, errors)
        if rid and rid in ids:
            errors.append(f"{where}: duplicate id {rid!r}")
        if rid:
            ids.add(str(rid))
        for key in ("segment_id", "beat", "clip_source", "clip_file", "motion_type", "hero_subject", "grade_note", "generation"):
            _required(row, key, where, errors)
        try:
            start, end = float(row["start_s"]), float(row["end_s"])
            if end <= start:
                errors.append(f"{where}: end_s must exceed start_s")
            if start > last_end + 0.051:
                errors.append(f"{where}: visual coverage gap {last_end:.3f}s–{start:.3f}s")
            if start < last_end - 0.051:
                errors.append(f"{where}: overlapping visual coverage")
            last_end = end
        except (KeyError, TypeError, ValueError):
            errors.append(f"{where}: start_s/end_s must be numeric")
            start, end = 0.0, 0.0
        path_s = str(row.get("clip_file", ""))
        if not path_s.lower().endswith(".mp4"):
            errors.append(f"{where}: clip_file must be a .mp4, never a still image")
        relative_clip = Path(path_s)
        clip = (ep / relative_clip).resolve()
        try:
            clip.relative_to(ep.resolve())
        except ValueError:
            # Localized variants may intentionally share an `assets` symlink with an
            # approved sibling episode. Permit only that explicit, no-traversal path.
            shared_assets = (ep / "assets").is_symlink() and relative_clip.parts and relative_clip.parts[0] == "assets" and ".." not in relative_clip.parts
            if not shared_assets:
                errors.append(f"{where}: clip_file must remain inside the episode directory")
        gen = row.get("generation", {}) if isinstance(row.get("generation"), dict) else {}
        for key in ("provider", "prompt", "seed", "reference_image", "style_reference", "source_duration_s", "cache_key"):
            _required(gen, key, f"{where}.generation", errors)
        if gen.get("provider") not in PROVIDERS:
            errors.append(f"{where}: unsupported provider key {gen.get('provider')!r}")
        try:
            generated_s = float(gen.get("source_duration_s", 0))
            if generated_s + 0.01 < (end - start) and row.get("loop") is not True:
                errors.append(f"{where}: source clip is shorter than beat; loop must be true")
        except (TypeError, ValueError):
            errors.append(f"{where}: generation.source_duration_s must be numeric")
        if index == 0:
            cover_lock = row.get("cover_lock", {}) if isinstance(row.get("cover_lock"), dict) else {}
            if cover_lock.get("first_frame_pixel_match") is not True:
                errors.append(f"{where}: hero live clip must pixel-match the approved cover at frame zero")
            hold = cover_lock.get("static_hold_frames")
            if not isinstance(hold, int) or not 15 <= hold <= 30:
                errors.append(f"{where}: hero cover hold must be 15–30 frames")
            if strict and cover_lock.get("first_frame_reference") and not (ep / str(cover_lock["first_frame_reference"])).is_file():
                errors.append(f"{where}: missing approved cover reference {cover_lock['first_frame_reference']}")
        if strict and not clip.is_file():
            errors.append(f"{where}: missing live clip {path_s}")
        if strict and clip.is_file() and clip.stat().st_size < 1024:
            errors.append(f"{where}: live clip is implausibly small")
    if beats and abs(float(beats[0].get("start_s", 9))) > 0.051:
        errors.append("first visual beat must start at 0.0 to cover frame zero")
    total = float(read_json(ep / "timeline.json").get("total", 0))
    if last_end + 0.051 < total:
        errors.append(f"visual coverage ends at {last_end:.3f}s before timeline tail {total:.3f}s")
    return errors


def generation_pack(ep: Path, data: dict[str, Any] | None = None) -> Path:
    data = data or load_manifest(ep)
    continuity = data["continuity"]
    rows = [
        f"# LIVE MOTION GENERATION PACK — {ep.name}",
        "",
        "This is an operator handoff, not a vendor-API promise. Export muted, vertical MP4 clips to the exact paths in `motion-manifest.json`; the film stage owns final score and dialogue.",
        "",
        "## Locked continuity contract",
        "",
        f"- **Subject reference:** `{continuity['subject_reference']}`",
        f"- **Style reference:** `{continuity['style_reference']}`",
        f"- **Lighting:** `{continuity['key_light']}` · **WB:** {continuity['white_balance_kelvin'][0]}–{continuity['white_balance_kelvin'][1]}K",
        f"- **Camera:** {continuity['camera_language']}",
        f"- **House grade:** {continuity['house_grade']}",
        "- **No embedded text, logos, UI, watermark, native audio, or random grain.**",
        "- Lock one reference image + one style reference across generated human shots. Append rerolls (`_v2`, `_v3`); do not overwrite a selected clip.",
        "",
        "## Beat contracts",
        "",
    ]
    for row in data["beats"]:
        gen = row["generation"]
        provider = gen["provider"]
        rows.extend([
            f"### {row['id']} · {row['start_s']:.2f}s–{row['end_s']:.2f}s · {row['beat']}",
            "",
            f"- **Provider lane:** `{provider}` — {PROVIDERS[provider]}",
            f"- **Deliver:** `{row['clip_file']}` · {data['resolution']} · {data['fps']}fps · muted MP4 · at least {gen['source_duration_s']}s",
            f"- **Motion:** {row['motion_type']}",
            f"- **One moving hero:** {row['hero_subject']}",
            f"- **Loop:** {'YES — extend/loop without a tail freeze' if row['loop'] else 'No loop needed if delivered longer than the beat'}",
            f"- **Grade:** {row['grade_note']}",
            f"- **Seed:** `{gen['seed']}` · **cache key:** `{gen['cache_key']}`",
            *( [f"- **Hero cover lock:** first frame pixel-matches `{row['cover_lock']['first_frame_reference']}`; hold exactly `{row['cover_lock']['static_hold_frames']}` frames before visible motion."] if row.get('cover_lock', {}).get('first_frame_pixel_match') else [] ),
            "",
            "```text",
            gen["prompt"],
            "```",
            "",
        ])
    rows.extend([
        "## Before handing clips to Film",
        "",
        "```bash",
        f"python3 tools/engine/motion_manifest.py episodes/{ep.name} validate --strict",
        f"python3 tools/engine/motion_qc.py episodes/{ep.name}",
        "```",
        "",
        "A missing MP4, a still image, near-static two-second window, duplicate shot, freeze-tail, or unmatched grade is a rebuild—not a delivery exception.",
    ])
    output = ep / PACK
    output.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return output


def main() -> None:
    ap = argparse.ArgumentParser(description="FBM live-motion manifest gate")
    ap.add_argument("episode_dir")
    ap.add_argument("command", choices=["plan", "validate", "generation-pack"])
    ap.add_argument("--strict", action="store_true", help="require every selected MP4 to exist")
    ap.add_argument("--overwrite", action="store_true", help="replace a planned manifest")
    args = ap.parse_args()
    ep = Path(args.episode_dir).resolve()
    try:
        if args.command == "plan":
            plan(ep, overwrite=args.overwrite)
        elif args.command == "generation-pack":
            out = generation_pack(ep)
            print(f"GENERATION PACK · {out}")
        else:
            errors = validate(ep, strict=args.strict)
            print(f"MOTION MANIFEST · {ep.name} · {'STRICT' if args.strict else 'PLAN'}")
            if errors:
                for error in errors:
                    print("  [FAIL]", error)
                raise SystemExit(1)
            print("RESULT: PASS")
    except ManifestError as exc:
        print("MOTION MANIFEST BLOCKED:", exc, file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
