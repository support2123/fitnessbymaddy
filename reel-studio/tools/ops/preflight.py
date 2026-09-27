#!/usr/bin/env python3
"""Doctrine preflight gate for an FBM reel episode.

Usage: python3 tools/ops/preflight.py episodes/EPISODE [--stage planning|script|release]
The command is deliberately strict: a missing record is a failed gate, not an assumed pass.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "config/studio.json").read_text())


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f"missing required record: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("episode_dir")
    ap.add_argument("--stage", choices=["planning", "script", "release"], default="release")
    args = ap.parse_args()
    ep = Path(args.episode_dir).resolve()
    m = load(ep / "production-manifest.json")
    fail: list[str] = []
    warn: list[str] = []

    def need(condition: bool, label: str) -> None:
        (warn if args.stage == "planning" else fail).append(label) if not condition else None

    need((ep / "request.json").exists(), "Request Card record exists")
    need((ep / "planning.json").exists(), "duration and reveal planning exists")
    need(m.get("script", {}).get("tier") in {"A", "B", "C"}, "duration tier A, B, or C selected")
    need(m.get("hook", {}).get("reveal") in {"name", "tease"}, "named or teased hook decision recorded")

    if args.stage in {"script", "release"}:
        need(m.get("approvals", {}).get("research_spine") == "approved", "research spine approved")
        hook = m.get("hook", {})
        need(bool(hook.get("archetype")), "hook archetype recorded")
        need(bool(hook.get("on_screen")) and bool(hook.get("spoken")), "separate on-screen and spoken hook lines present")
        script = m.get("script", {})
        need(bool(script.get("the_turn")), "the single script turn is recorded")
        need(script.get("citations_verified") is True, "citations marked verified")
        missing_viral = [k for k, v in script.get("viral_6", {}).items() if not v]
        need(not missing_viral, "Viral 6/6 passed" + (f"; missing {', '.join(missing_viral)}" if missing_viral else ""))
        need(m.get("approvals", {}).get("final_script") == "approved", "final script approved")

    if args.stage == "release":
        need(m.get("voice", {}).get("verification") == "PASS", "voice verification PASS")
        need(m.get("voice", {}).get("mode") == "clone", "authority release uses the cloned voice")
        timeline = m.get("timeline", {})
        need(timeline.get("status") == "ready", "audio-led timeline ready")
        need(timeline.get("clock_final_value") is not None and timeline.get("cta_timecode_seconds") is not None, "Living Clock final value and CTA timecode recorded")
        hero = m.get("hero", {})
        need(hero.get("status") == "locked", "hero concept and reviewed still locked")
        need(hero.get("frame_zero_no_black") is True, "frame zero is a full-bleed hero, never black")
        need(hero.get("cover_pixel_match") is True, "uploaded cover is pixel-matched to frame zero")
        need(hero.get("thumbnail_test_150px") == "approved", "150px thumbnail test approved")
        motion = m.get("motion", {})
        need((ep / str(motion.get("manifest", "motion-manifest.json"))).exists(), "live-motion manifest exists")
        need(motion.get("status") == "PASS", "ASSET / B-ROLL stage PASS")
        need(motion.get("every_beat_moving") is True and motion.get("distinct_shots") is True, "every beat has a distinct moving shot")
        need(motion.get("house_grade") == "PASS", "one-film house grade PASS")
        need(motion.get("optical_flow_qc") == "PASS" and motion.get("freeze_tail_qc") == "PASS", "optical-flow and freeze-tail motion QC PASS")
        clock = m.get("design", {}).get("living_clock", {})
        need(all(clock.get(k) is True for k in ("environment", "telemetry", "trace", "lands_on_cta", "prominent_top_right", "score_synced")), "Living Clock is prominent, score-synced, drives environment/telemetry/trace, and lands on CTA")
        kinetic = m.get("design", {}).get("kinetic_type", {})
        need(kinetic.get("word_reveal") is True and kinetic.get("fixed_number_pop_land") is True, "word reveal and fixed-number pop-land are recorded")
        need(m.get("design", {}).get("citations_lifted") is True, "citation chips are lifted clear of platform UI")
        need(m.get("design", {}).get("safe_zone_review") == "PASS", "safe-zone review PASS")
        need(m.get("design", {}).get("world_class_bar") == "PASS", "DOCTRINE-03/04 world-class bar PASS")
        audio = m.get("audio", {})
        need(audio.get("integrated_lufs") == -14, "integrated loudness is -14 LUFS")
        need(float(audio.get("true_peak_db", 99)) <= -1, "true peak is at or below -1 dBTP")
        need(audio.get("sample_rate_hz") == 48000, "AAC pipeline is 48 kHz")
        need(audio.get("manual_ducking") == "PASS", "music ducking is timeline-based, not pumping")
        quality = m.get("quality", {})
        need(quality.get("motion_qc") == "PASS", "live-motion QC PASS")
        need(quality.get("qc") == "PASS", "technical QC PASS")
        need(quality.get("brand_gate") == "PASS", "brand gate PASS")
        need(float(quality.get("fresh_eyes_score", 0)) >= CONFIG["quality_gates"]["fresh_eyes_minimum_score"], "Fresh Eyes score is at least 8.5")
        need(quality.get("sterile_publish") == "PASS", "sterile publish PASS")
        release = m.get("release", {})
        need(all(release.get(k) for k in ("master", "master_sha256", "cover", "caption", "pinned_comment", "series_loop")), "complete upload pack and series loop recorded")
        need(m.get("approvals", {}).get("publish") == "approved", "publish approved")

    print(f"PREFLIGHT · {ep.name} · {args.stage.upper()}")
    for line in warn:
        print("  [WARN]", line)
    for line in fail:
        print("  [FAIL]", line)
    if not fail:
        print("RESULT: PASS" + (" WITH PLANNING WARNINGS" if warn else ""))
    else:
        print(f"RESULT: BLOCKED ({len(fail)} gate(s))")
        sys.exit(1)


if __name__ == "__main__":
    main()
