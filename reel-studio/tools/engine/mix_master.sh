#!/usr/bin/env bash
# Doctrine edition: invoke the 48 kHz timeline-envelope mixer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec python3 "$ROOT/tools/engine/mix_master.py" "$@"
