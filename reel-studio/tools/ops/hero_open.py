#!/usr/bin/env python3
"""Plan and lock the cover-identical hero open for a doctrine-locked episode.

The command creates a brief only. It intentionally does not call an image model: the
creative image must be visibly reviewed before it becomes an episode's first frame.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONCEPTS = json.loads((ROOT / "content/hero-concepts.json").read_text())
CONFIG = json.loads((ROOT / "config/studio.json").read_text())


def choose_concept(topic: str) -> dict:
    words = topic.lower()
    signals = {
        "visceral_glowing_anatomy": ("heart", "lung", "breath", "nerve", "brain", "vo2"),
        "cutaway_cross_section": ("muscle", "fat", "tendon", "joint", "protein"),
        "distortion_of_familiar": ("scale", "weight", "water", "retention"),
        "number_made_physical": ("calorie", "sugar", "step", "hour"),
        "confrontation_gaze": ("discipline", "mindset", "effort"),
        "body_under_threat": ("stress", "cortisol", "inflammation", "sitting"),
        "macro_hyperreal_detail": ("hydration", "sweat", "skin", "cell"),
        "elemental_body": ("strength", "mitochondria", "power")
    }
    for concept_id, markers in signals.items():
        if any(marker in words for marker in markers):
            return next(c for c in CONCEPTS["concepts"] if c["id"] == concept_id)
    return next(c for c in CONCEPTS["concepts"] if c["id"] == "uncanny_scale")


def find_concept(value: str) -> dict:
    normal = value.lower().replace(" ", "_")
    for concept in CONCEPTS["concepts"]:
        if normal in {concept["id"], concept["name"].lower().replace(" ", "_")}:
            return concept
    available = ", ".join(c["name"] for c in CONCEPTS["concepts"])
    raise SystemExit(f"unknown concept {value!r}; choose one of: {available}")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--concept", default="auto")
    ap.add_argument("--lock-still", help="reviewed 1080x1920 PNG/JPG to make the cover and frame zero")
    args = ap.parse_args()

    ep = Path(args.episode_dir).resolve()
    request = load_json(ep / "request.json")
    manifest_path = ep / "production-manifest.json"
    manifest = load_json(manifest_path)
    concept = choose_concept(request["topic"]) if args.concept == "auto" else find_concept(args.concept)
    hero_dir = ep / "hero"
    hero_dir.mkdir(exist_ok=True)
    title_band = CONCEPTS["cover_lock"]["negative_space_bands"][0]
    prompt = (
        f"{concept['subject_prompt']} representing {request['topic']}, "
        f"{CONCEPTS['master_prompt_suffix']}. Reserve {title_band}."
    )
    hero = {
        "status": "briefed",
        "concept": concept["name"],
        "concept_id": concept["id"],
        "topic": request["topic"],
        "emotion": concept["emotion"],
        "prompt": prompt,
        "generation_rules": {
            "no_baked_text": True,
            "hero_frame": "one subject, one light, one question",
            "focal_point": CONCEPTS["cover_lock"]["focal_point"],
            "safe_hero_zone": CONCEPTS["cover_lock"]["safe_hero_zone"],
            "thumbnail_test": CONCEPTS["cover_lock"]["thumbnail_test"]
        },
        "frame_zero": {
            "no_black": True,
            "static_hold_frames": CONFIG["hero_open"]["static_hold_frames"],
            "cover_pixel_match_required": True,
            "motion_after_hold": CONCEPTS["cover_lock"]["motion_after_hold"]
        },
        "source_still": None,
        "cover_still": None,
        "review": {"thumbnail_150px": "pending", "safe_zone": "pending", "human_body": "pending"}
    }

    if args.lock_still:
        still = Path(args.lock_still).resolve()
        if not still.exists():
            raise SystemExit(f"hero still not found: {still}")
        try:
            from PIL import Image
        except ImportError as exc:
            raise SystemExit("Pillow is required only when locking a hero still. Run zsh tools/engine/bootstrap_env.sh first.") from exc
        with Image.open(still) as image:
            if image.size != (1080, 1920):
                raise SystemExit(f"hero still must be exactly 1080x1920, received {image.size[0]}x{image.size[1]}")
        hero["status"] = "locked"
        hero["source_still"] = str(still)
        hero["cover_still"] = str(still)
        hero["review"] = {"thumbnail_150px": "approved", "safe_zone": "approved", "human_body": "approved"}
        manifest["hero"].update({
            "status": "locked", "concept": concept["name"], "source_still": str(still), "cover_still": str(still),
            "frame_zero_no_black": True, "cover_pixel_match": True, "thumbnail_test_150px": "approved"
        })
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    (hero_dir / "hero-open.json").write_text(json.dumps(hero, indent=2) + "\n")
    (hero_dir / "hero-brief.md").write_text(
        f"# HERO OPEN — {request['episode']}\n\n"
        f"**Concept:** {concept['name']}  \n**Emotion:** {concept['emotion']}\n\n"
        "## Generation prompt\n\n> " + prompt + "\n\n"
        "## First-second direction\n\n"
        "1. Hold the final cover-identical still for 15–30 frames.\n"
        "2. Start a restrained push from 1.00 to 1.06 only after the hold.\n"
        "3. Add depth with parallax and low-opacity atmosphere. Do not shake text.\n"
        "4. Hit one gold bloom pulse on the first impact. Reveal type on the living image.\n"
        "5. Export the reviewed 1080x1920 still and set it manually as the social cover.\n\n"
        "## Lock checklist\n\n"
        "- [ ] No baked text in generated image\n- [ ] 150px square thumbnail test passed\n- [ ] Subject and title fit safe zones\n- [ ] Human body present when anatomy is shown\n- [ ] Cover PNG exactly matches frame zero\n",
        encoding="utf-8"
    )
    print(f"HERO BRIEF READY · {ep.name} · {concept['name']}")
    if not args.lock_still:
        print("Generate and review the still, then rerun with --lock-still <1080x1920 image>.")
    else:
        print("HERO LOCKED · cover and frame zero point to the reviewed still.")


if __name__ == "__main__":
    main()
