#!/usr/bin/env bash
# Writes the Rust sources cited in src/content/components.ts, as they were at the pinned commit,
# into tests/fixtures/rust-src-<short>/ (the citation test reads these, not the working tree).
# Usage: tools/snapshot_rust_src.sh [COMMIT]   (default: COMMIT from components.ts)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
commit="${1:-$(sed -n "s/^export const COMMIT = '\([0-9a-f]*\)'.*/\1/p" "$here/../src/content/components.ts")}"
short="${commit:0:7}"
out="$here/../tests/fixtures/rust-src-$short"
rm -rf "$out"
grep -o "file: '[^']*'" "$here/../src/content/components.ts" | sed "s/file: '\(.*\)'/\1/" | sort -u | while read -r f; do
  mkdir -p "$out/$(dirname "$f")"
  git show "$commit:albert-moe-13/moe-llm-core/src/$f" > "$out/$f"
done
ls -R "$out" | head -30
