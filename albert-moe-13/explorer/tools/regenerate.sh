#!/usr/bin/env bash
# Regenerates all measured data from a checkpoint (spec 6.3): architecture.json, then the traces,
# then validates every trace against the new architecture.json.
# Usage: tools/regenerate.sh CHECKPOINT      (Colony only; see README for the memory gate)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ckpt="${1:?usage: regenerate.sh CHECKPOINT}"
python3 -I "$here/build_architecture.py" "$ckpt" "$here/../../models/albert_v3.0.config.json" "$here/../public/data/architecture.json"
bash "$here/run_traces.sh" "$ckpt"
# tests/trace.test.ts runs validateTrace on every public/data/trace/*.json
(cd "$here/.." && npx vitest run tests/trace.test.ts)
