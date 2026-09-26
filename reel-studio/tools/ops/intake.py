#!/usr/bin/env python3
"""Create a doctrine-locked reel episode from a Request Card.

This is a planning command. It never creates a voice, renders an image, or marks a
claim as true. Research approval remains a human gate.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "config/studio.json").read_text())


def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").upper()
    return re.sub(r"-+", "-", value)[:52]


def parse_duration(value: str) -> int | None:
    value = value.strip().lower()
    if value == "auto":
        return None
    if value.endswith("min"):
        return int(float(value[:-3]) * 60)
    if value.endswith("s"):
        return int(float(value[:-1]))
    raise ValueError("duration must be auto, 15s, 30s, 45s, 60s, 90s, or 2min")


def route_tier(duration: int | None, depth: str, topic: str, tip: str) -> tuple[str, str]:
    if duration is not None:
        if duration <= 30:
            return "A", "requested runtime fits a single-idea tier"
        if duration <= 60:
            return "B", "requested runtime fits myth-plus-fix tier"
        return "C", "requested runtime needs a flagship mechanism tier"
    if depth in {"one", "myth", "deep"}:
        return {"one": "A", "myth": "B", "deep": "C"}[depth], f"operator depth hint: {depth}"
    words = (topic + " " + tip).lower()
    deep_markers = ("mechanism", "system", "full mechanism", "versus", "and why", "inside")
    myth_markers = ("myth", "lie", "wrong", "bulky", "does not", "doesn't", "stop")
    if any(marker in words for marker in deep_markers):
        return "C", "auto router found a multi-angle mechanism request"
    if any(marker in words for marker in myth_markers):
        return "B", "auto router found a myth-plus-fix request"
    return "B", "auto router defaults to concise myth-plus-fix over padded flagship"


def reveal_choice(force: str) -> tuple[str, str]:
    if force in {"name", "tease"}:
        return force, "operator selected the reveal mode"
    state = json.loads((ROOT / "content/slate-state.json").read_text())
    history = state.get("history", [])[-state["policy"]["rolling_window"]:]
    named = sum(1 for entry in history if entry.get("reveal") == "name")
    teased = sum(1 for entry in history if entry.get("reveal") == "tease")
    target = state["policy"]["target"]
    if named < target["named"] and named <= teased + 1:
        return "name", f"slate has {named} named and {teased} teased in its active window"
    if teased < target["teased"]:
        return "tease", f"slate has {named} named and {teased} teased in its active window"
    return state.get("next_recommendation", "name"), "slate is balanced; use the recorded rotation"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", required=True)
    parser.add_argument("--duration", default="auto")
    parser.add_argument("--tip", default="")
    parser.add_argument("--episode", default="")
    parser.add_argument("--depth", choices=["auto", "one", "myth", "deep"], default="auto")
    parser.add_argument("--reveal", choices=["auto", "name", "tease"], default="auto")
    args = parser.parse_args()

    duration = parse_duration(args.duration)
    tier, tier_reason = route_tier(duration, args.depth, args.topic, args.tip)
    reveal, reveal_reason = reveal_choice(args.reveal)
    episode_id = args.episode.strip().upper() or f"{slugify(args.topic)}-01"
    ep = ROOT / "episodes" / episode_id
    if ep.exists() and any(ep.iterdir()):
        raise SystemExit(f"refusing to overwrite populated episode: {ep}")
    ep.mkdir(parents=True, exist_ok=True)
    (ep / "hero").mkdir(exist_ok=True)
    (ep / "qc").mkdir(exist_ok=True)

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    request = {
        "episode": episode_id,
        "topic": args.topic.strip(),
        "duration_request": args.duration,
        "tip": args.tip.strip(),
        "created_at": now,
        "state": "intake-complete"
    }
    planning = {
        "tier": tier,
        "tier_reason": tier_reason,
        "duration_seconds": CONFIG["duration_router"]["tiers"][tier]["seconds"],
        "shape": CONFIG["duration_router"]["tiers"][tier]["structure"],
        "reveal": reveal,
        "reveal_reason": reveal_reason,
        "non_negotiables": [
            "research approval before final script",
            "every statistic resolves to a locked citation",
            "frame zero is a full-bleed cover-locked hero",
            "Living Clock lands on CTA",
            "Fresh Eyes score must be at least 8.5"
        ]
    }
    manifest = json.loads((ROOT / "templates/production-manifest.json").read_text())
    manifest["episode"] = episode_id
    manifest["hook"]["reveal"] = reveal
    manifest["script"]["tier"] = tier

    write_json(ep / "request.json", request)
    write_json(ep / "planning.json", planning)
    write_json(ep / "production-manifest.json", manifest)
    (ep / "research.md").write_text(
        f"# RESEARCH — {episode_id}\n\n"
        f"**Topic:** {args.topic.strip()}\n\n"
        "## Citation spine\n\n"
        "- [ ] Every proposed number is linked to a `status: locked` citation-library entry.\n"
        "- [ ] Confidence tier and exact source wording are recorded.\n"
        "- [ ] Correlation and causation are separated explicitly.\n\n"
        "## Six-angle gauntlet\n\n"
        "1. Tax\n2. Mechanism\n3. Myth\n4. Protocol\n5. Proof\n6. Identity\n\n"
        "## Approval\n\n"
        "- [ ] Maddy approved the research spine.\n",
        encoding="utf-8"
    )
    (ep / "SCRIPT-FINAL.md").write_text(
        f"# SCRIPT — {episode_id}\n\n"
        f"**Tier:** {tier}  \n**Reveal mode:** {reveal}\n\n"
        "Complete this only after `research.md` is approved. Keep ON-SCREEN and SPOKEN layers separate.\n\n"
        "## Hook\n\n- Archetype:\n- ON-SCREEN:\n- SPOKEN:\n- Citation card:\n\n"
        "## Beat map\n\n"
        + "\n".join(f"- **{beat.upper()}** — ON-SCREEN / SPOKEN / citation / visual change" for beat in planning["shape"])
        + "\n\n## The turn\n\n\n## Honesty bound\n\n\n## CTA\n\n- Owned number:\n- Series loop:\n\n## Viral 6/6\n\n- [ ] Shareable\n- [ ] Saveable\n- [ ] Commentable\n- [ ] Rewatch\n- [ ] Screenshot\n- [ ] Wait-for-next\n",
        encoding="utf-8"
    )
    stem = slugify(episode_id).lower().replace("-", "_")
    film = (ROOT / "templates/film_doctrine.py.template").read_text()
    film = film.replace("__EPISODE__", episode_id).replace("__TITLE__", args.topic.strip().upper())
    (ep / f"film_{stem}.py").write_text(film, encoding="utf-8")
    bed = (ROOT / "templates/bed_doctrine.py.template").read_text().replace("__EPISODE__", episode_id)
    (ep / f"bed_{stem}.py").write_text(bed, encoding="utf-8")
    print(f"INTAKE READY · {episode_id}")
    print(f"  tier: {tier} ({tier_reason})")
    print(f"  reveal: {reveal} ({reveal_reason})")
    print("NEXT: complete research.md and obtain research approval. No VO or render is authorized yet.")


if __name__ == "__main__":
    main()
