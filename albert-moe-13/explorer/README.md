# albert. 3D Explorer

Browser 3D exhibit of albert. (46 layers, dual stream, ternary MoE). Vite + three.js + TypeScript.

Scene: 46 glass slabs in a row along +X. Per slab, stream A lane (y=-1.8, yellow), stream B lane
(y=+1.8, mint), a shared 12-expert bank between them, and a gate arc on fusion slabs.

## Commands (run on the Colony, not the ZBook)

    colony-run -- 'cd albert-moe-13/explorer && npm ci && npx vitest run && npm run build'

Data: `public/data/architecture.json` (see `tools/build_architecture.py`).
