#!/usr/bin/env python3
"""Browse the content OS and start a doctrine-era episode.

The former legacy scaffold is intentionally replaced. New episodes must enter through
`tools/ops/intake.py` so duration routing, name-vs-tease balance, hero-open planning,
and the ten-strike manifest are present from the first file.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOPICS = json.loads((ROOT / "content/topics.json").read_text())


def slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-")).upper()[:52]


def find_topic(query: str) -> dict | list[dict] | None:
    query = query.lower().strip()
    exact = [item for item in TOPICS["topics"] if item["id"].lower() == query]
    if exact:
        return exact[0]
    hits = [item for item in TOPICS["topics"] if query in item["title"].lower()]
    return hits[0] if len(hits) == 1 else (hits or None)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("topic", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pillar")
    ap.add_argument("--role")
    ap.add_argument("--tier")
    ap.add_argument("--duration", default="auto")
    ap.add_argument("--tip", default="")
    ap.add_argument("--episode", default="")
    ap.add_argument("--reveal", choices=["auto", "name", "tease"], default="auto")
    ap.add_argument("--depth", choices=["auto", "one", "myth", "deep"], default="auto")
    args = ap.parse_args()

    if args.list or not args.topic:
        rows = TOPICS["topics"]
        for key, value in (("pillar_key", args.pillar), ("role", args.role), ("tier", args.tier)):
            if value:
                rows = [item for item in rows if item.get(key) == value]
        for item in rows:
            print(f"{item['id']:18} {item['role'][:17]:18} {item['tier']:3} {item['funnel'] or '—':12} {item['title'][:66]}")
        print(f"\n{len(rows)} topics · create one with: python3 tools/engine/new_episode.py <TOPIC_ID>")
        return

    hit = find_topic(args.topic)
    if hit is None:
        raise SystemExit(f"no topic matched {args.topic!r}; use --list")
    if isinstance(hit, list):
        raise SystemExit("ambiguous topic: " + ", ".join(f"{item['id']} ({item['title']})" for item in hit))
    episode = args.episode.strip().upper() or f"{slugify(hit['title'])}-01"
    cmd = [sys.executable, str(ROOT / "tools/ops/intake.py"), "--topic", hit["title"], "--duration", args.duration,
           "--tip", args.tip or (hit.get("detail") or ""), "--episode", episode, "--reveal", args.reveal, "--depth", args.depth]
    print("DOCTRINE INTAKE:", " ".join(cmd))
    raise SystemExit(subprocess.run(cmd).returncode)


if __name__ == "__main__":
    main()
