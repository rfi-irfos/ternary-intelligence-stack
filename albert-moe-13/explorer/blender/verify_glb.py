"""Verify the albert. explorer glb modules (stdlib only).

Usage: python3 blender/verify_glb.py public/assets
Checks the node-name contract, slot positions against src/scene/tower.ts
(local coordinates) and the 6 MB size cap. Exit code 1 on any failure.
"""
import json
import os
import struct
import sys

MAX_BYTES = 6 * 1024 * 1024
EXPERTS = [f"slot_expert_{i:02d}" for i in range(12)]
PAIRS = [f"slot_{k}_{s}" for k in ("attn", "router", "ln1", "ln2") for s in "AB"]
SLAB = EXPERTS + PAIRS + ["lane_anchor_A", "lane_anchor_B"]
CONTRACT = {
    "slab.glb": SLAB,
    "slab_fusion.glb": SLAB + ["slot_gate"],
    "embed.glb": ["slot_embed"],
    "lm_head.glb": ["slot_lm_head"],
}


def expected_positions():
    pos = {}
    for e in range(12):
        pos[f"slot_expert_{e:02d}"] = (0.0, (e % 3 - 1) * 0.7, ((e // 3) % 4 - 1.5) * 0.7 + 0.4)
    offs = {"ln1": -1.0, "attn": -0.35, "ln2": 0.3, "router": 0.95}
    for s, y in (("A", -1.8), ("B", 1.8)):
        for k, x in offs.items():
            pos[f"slot_{k}_{s}"] = (x, y, -1.2)
        pos[f"lane_anchor_{s}"] = (0.0, y, -1.2)
    pos["slot_gate"] = (0.45, 0.0, 0.7)
    pos["slot_embed"] = pos["slot_lm_head"] = (0.0, 0.0, 0.0)
    return pos


def read_json(path):
    with open(path, "rb") as f:
        magic, _ver, _length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError("not a glb")
        clen, ctype = struct.unpack("<II", f.read(8))
        if ctype != 0x4E4F534A:
            raise ValueError("first chunk is not JSON")
        return json.loads(f.read(clen))


def verify(path, want):
    errs = []
    size = os.path.getsize(path)
    if size >= MAX_BYTES:
        errs.append(f"{path}: {size} bytes >= 6 MB")
    nodes = {n.get("name"): n for n in read_json(path)["nodes"]}
    exp = expected_positions()
    for name in want:
        n = nodes.get(name)
        if n is None:
            errs.append(f"{path}: missing node {name}")
            continue
        t = n.get("translation", [0.0, 0.0, 0.0])
        if any(abs(a - b) > 1e-4 for a, b in zip(t, exp[name])):
            errs.append(f"{path}: {name} at {t}, expected {list(exp[name])}")
    return errs


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "public/assets"
    errs = []
    for fname, want in CONTRACT.items():
        p = os.path.join(d, fname)
        if not os.path.exists(p):
            errs.append(f"missing file {p}")
            continue
        errs += verify(p, want)
        print(f"{fname}: {os.path.getsize(p)} bytes")
    for e in errs:
        print("FAIL", e)
    print("OK" if not errs else f"{len(errs)} failure(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
