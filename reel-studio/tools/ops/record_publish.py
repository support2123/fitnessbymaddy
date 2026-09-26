#!/usr/bin/env python3
"""Record a release in the slate only after the full doctrine preflight passes."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    args = ap.parse_args()
    ep = Path(args.episode_dir).resolve()
    check = subprocess.run([sys.executable, str(Path(__file__).with_name("preflight.py")), str(ep), "--stage", "release"])
    if check.returncode:
        raise SystemExit("release was not recorded: doctrine preflight is blocked")
    manifest = json.loads((ep / "production-manifest.json").read_text())
    reveal = manifest["hook"]["reveal"]
    state_path = ROOT / "content/slate-state.json"
    state = json.loads(state_path.read_text())
    history = state.setdefault("history", [])
    if any(item.get("episode") == manifest["episode"] for item in history):
        raise SystemExit(f"{manifest['episode']} is already recorded in the slate")
    history.append({
        "episode": manifest["episode"],
        "reveal": reveal,
        "recorded_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "series_loop": manifest["release"]["series_loop"]
    })
    window = history[-state["policy"]["rolling_window"]:]
    named = sum(1 for item in window if item["reveal"] == "name")
    teased = sum(1 for item in window if item["reveal"] == "tease")
    target = state["policy"]["target"]
    state["next_recommendation"] = "name" if named < target["named"] else "tease" if teased < target["teased"] else "name"
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    print(f"RECORDED · {manifest['episode']} · {reveal}")
    print(f"Active {len(window)}-reel mix: {named} named / {teased} teased · next recommendation: {state['next_recommendation']}")


if __name__ == "__main__":
    main()
