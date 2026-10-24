#!/usr/bin/env bash
# Headless HUD check of the built explorer (coverage, panel height, A6 table, F-GPU-3, click-out, R1).
# Runs on the Colony (Playwright in ~/work/pw, Chrome with SwiftShader). It never edits this tree: it
# copies the app to a temp dir, adds the dev-only window.__albert hook THERE, builds and previews it
# on port 4181, runs e2e/hud.cjs and removes the copy.
#   bash e2e/run.sh            measurements only (stdout: one "HUD {...}" JSON line)
#   SHOTS=1 OUT=dir bash e2e/run.sh   plus screenshots into dir
#   SCRIPT=lobby.cjs ...              the lobby / intro / quick pass check instead (Task 12)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
port="${PORT:-4181}"
work="$(mktemp -d)"
cleanup() {
  [ -n "${preview_pid:-}" ] && kill "$preview_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
tar -C "$here" --exclude=node_modules --exclude=dist -cf - . | tar -C "$work" -xf -
ln -s "$here/node_modules" "$work/node_modules"
cd "$work"
grep -q '^  const timer = new THREE.Timer();' src/main.ts || { echo 'hook anchor missing in src/main.ts' >&2; exit 2; }
sed -i "s|^  const timer = new THREE.Timer();|  (window as any).__albert = { bar, rig, view, panel, layerMode, legend, camera, tower, top, lobby, flow, look };\n  const timer = new THREE.Timer();|" src/main.ts
vite="$here/node_modules/.bin/vite"
"$vite" build --logLevel error >/dev/null
# vite itself (not npx), so the pid below is the server and the trap really stops it
"$vite" preview --port "$port" --strictPort >/dev/null 2>&1 &
preview_pid=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.5; done
kill -0 "$preview_pid" 2>/dev/null || { echo "preview did not start (port $port busy?)" >&2; exit 3; }
mkdir -p "${OUT:-$here/e2e/out}"
OUT="${OUT:-$here/e2e/out}" URL="http://127.0.0.1:$port/" node "$here/e2e/${SCRIPT:-hud.cjs}"
