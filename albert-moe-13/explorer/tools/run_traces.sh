#!/usr/bin/env bash
# Records one real trace per prompt in tools/prompts.json: one fresh process per prompt
# (fresh process = warm-up, traffic-light modifiers inactive).
# Usage: tools/run_traces.sh CHECKPOINT [OUT_DIR]
# Env:   COMMIT (git commit of the code that is run; default: git rev-parse HEAD)
#        BIN    (albert_trace binary; default: built with cargo --release --features trace)
# Run on the Colony only. Check `free -m` first: the run needs about 2.5 GB available.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"              # albert-moe-13
ckpt="${1:?usage: run_traces.sh CHECKPOINT [OUT_DIR]}"
out="${2:-$here/../public/data/trace}"
commit="${COMMIT:-$(git -C "$root" rev-parse HEAD)}"
mkdir -p "$out"
if [ -z "${BIN:-}" ]; then
  (cd "$root" && cargo build --release -p moe-llm-core --features trace --bin albert_trace)
  BIN="${CARGO_TARGET_DIR:-$root/target}/release/albert_trace"
fi
pj() { python3 -I -c 'import json,sys;d=json.load(open(sys.argv[1]));print(len(d) if sys.argv[2]=="n" else d[int(sys.argv[2])][sys.argv[3]],end="")' "$here/prompts.json" "$@"; }
n="$(pj n)"
for i in $(seq 0 $((n - 1))); do
  id="$(pj "$i" id)"
  prompt="$(pj "$i" prompt)"
  "$BIN" --checkpoint "$ckpt" --config "$root/models/albert_v3.0.config.json" \
    --tokenizer "$root/tokenizer_v3/tokenizer_v3.json" \
    --prompt-id "$id" --prompt "$prompt" --commit "$commit" --out "$out/$id.json"
done
