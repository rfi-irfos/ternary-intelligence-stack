import json
import random
import struct
from array import array
from pathlib import Path

import pytest

import build_weights as bw


def f32(vals):
    return array("f", vals)


# --- ternarisation (ste.rs:12-20: +1 if w > tau, -1 if w < -tau, else 0) ---


def test_ternarise_matches_ste_rule_at_the_boundaries():
    tau = 0.25  # exactly representable in f32
    above = float(array("f", [0.25 * (1 + 1e-6)])[0])
    below = float(array("f", [-0.25 * (1 + 1e-6)])[0])
    assert above > tau and below < -tau
    w = f32([tau, -tau, above, below, 0.0, 1.0, -1.0, 0.1])
    s = bw.matrix_summary("m", w, [1, 8], tau)
    assert s["tile"] == ["0" "0" "+" "-" "0" "+" "-" "0"]  # one row of 8
    assert s["frac_pos"] == 0.25 and s["frac_neg"] == 0.25 and s["frac_zero"] == 0.5


def test_fractions_sum_to_one():
    rnd = random.Random(1)
    w = f32([rnd.gauss(0, 0.1) for _ in range(64 * 48)])
    s = bw.matrix_summary("m", w, [64, 48], 0.05)
    assert abs(s["frac_neg"] + s["frac_zero"] + s["frac_pos"] - 1) < 3e-4
    assert s["ternary"] is True and s["dtype"] == "F32"
    assert sum(s["hist"]["counts"]) == 64 * 48 and len(s["hist"]["counts"]) == 256
    assert s["hist"]["min"] == min(w) and s["hist"]["max"] == max(w)
    assert s["gamma"] == float(f"{sum(abs(x) for x in w) / len(w):.6g}")


def test_tile_is_top_left_32x32():
    rows, cols = 40, 50
    w = f32([0.0] * (rows * cols))
    for r in range(rows):
        for c in range(cols):
            w[r * cols + c] = 1.0 if (r, c) in {(0, 0), (31, 31), (0, 31)} else 0.0
    w[0 * cols + 32] = -1.0  # outside the tile (col 32)
    w[32 * cols + 0] = -1.0  # outside the tile (row 32)
    s = bw.matrix_summary("m", w, [rows, cols], 0.5)
    t = s["tile"]
    assert len(t) == 32 and all(len(r) == 32 for r in t)
    assert t[0][0] == "+" and t[0][31] == "+" and t[31][31] == "+"
    assert "".join(t).count("+") == 3 and "-" not in "".join(t)


def test_f32_matrices_are_not_ternary():
    w = f32([i * 0.0123456 for i in range(12 * 64)])
    s = bw.matrix_summary("moe.gate", w, [12, 64], None)
    assert s["ternary"] is False and s["tau"] is None
    assert s["frac_neg"] is None and s["frac_zero"] is None and s["frac_pos"] is None
    assert len(s["tile"]) == 12 and len(s["tile"][0]) == 32
    assert s["tile"][1][0] == round(w[64], 3)
    assert isinstance(s["gamma"], float)


# --- synthetic checkpoint end to end ---

H, FF, V, E = 8, 16, 20, 3
FUSION = [1]


def synth_tensors(layers=2):
    t = {"embed.weight": [V, H], "lm_head.weight": [V, H], "ln_f.weight": [H], "ln_f.bias": [H]}
    for i in range(layers):
        for s in "ab":
            p = f"blocks.{i}.stream_{s}"
            for q in "qkvo":
                t[f"{p}.attn.{q}_proj.weight"] = [H, H]
            t[f"{p}.moe.gate.weight"] = [E, H]
            t[f"{p}.ln1.weight"] = [H]
        for e in range(E):
            p = f"blocks.{i}.experts.{e}"
            t[f"{p}.c_fc.weight"] = [FF, H]
            t[f"{p}.c_proj.weight"] = [H, FF]
            t[f"{p}.seed_bias"] = [H]
    for k in range(len(FUSION)):
        t[f"anastomosis.{k}.gate.weight"] = [2, 2 * H]
    return t


def write_ckpt(path, tensors, seed=0):
    rnd = random.Random(seed)
    header, blob, off = {"__metadata__": {"format": "pt"}}, bytearray(), 0
    for name, shape in tensors.items():
        n = 1
        for d in shape:
            n *= d
        data = array("f", [rnd.gauss(0, 0.1) for _ in range(n)]).tobytes()
        header[name] = {"dtype": "F32", "shape": shape, "data_offsets": [off, off + len(data)]}
        blob += data
        off += len(data)
    raw = json.dumps(header).encode()
    Path(path).write_bytes(struct.pack("<Q", len(raw)) + raw + bytes(blob))


def write_arch(path, layers=2):
    arch = {
        "model": {"num_layers": layers, "num_experts": E, "fusion_layers": FUSION},
        "layers": [
            {"index": i, "fusion": i in FUSION, "tau": 0.01 + 0.005 * i} for i in range(layers)
        ],
    }
    Path(path).write_text(json.dumps(arch))


@pytest.fixture
def synth(tmp_path):
    ck, ar = tmp_path / "c.safetensors", tmp_path / "arch.json"
    write_ckpt(ck, synth_tensors())
    write_arch(ar)
    return ck, ar, tmp_path / "weights"


def test_end_to_end_files_and_content(synth):
    ck, ar, out = synth
    assert bw.main([str(ck), str(ar), str(out)]) == 0
    assert sorted(p.name for p in out.iterdir()) == sorted(
        ["embed.json", "lm_head.json", "L0.json", "L1.json"]
    )
    l1 = json.loads((out / "L1.json").read_text())
    assert l1["layer"] == 1 and l1["fusion"] is True and l1["tau"] == 0.015
    names = [m["name"] for m in l1["matrices"]]
    assert names[0] == "stream_a.attn.q_proj.weight"
    assert "stream_b.moe.gate.weight" in names and "experts.2.c_proj.weight" in names
    assert "anastomosis.0.gate.weight" in names
    assert len(names) == 2 * 5 + 2 * E + 1
    byname = {m["name"]: m for m in l1["matrices"]}
    assert byname["stream_a.moe.gate.weight"]["ternary"] is False
    assert byname["anastomosis.0.gate.weight"]["ternary"] is False
    assert byname["experts.0.c_fc.weight"]["tau"] == 0.015
    assert [v["name"] for v in l1["vectors"]] == [f"experts.{e}.seed_bias" for e in range(E)]
    assert len(l1["vectors"][0]["head"]) == H
    l0 = json.loads((out / "L0.json").read_text())
    assert l0["fusion"] is False and not any("anastomosis" in m["name"] for m in l0["matrices"])
    emb = json.loads((out / "embed.json").read_text())["matrices"][0]
    assert emb["ternary"] is False and emb["name"] == "embed.weight"
    head = json.loads((out / "lm_head.json").read_text())["matrices"][0]
    assert head["ternary"] is True and head["tau"] == 0.02  # config.rs default threshold


def test_missing_tensor_fails_loudly_and_writes_nothing(tmp_path):
    t = synth_tensors()
    del t["blocks.1.experts.2.c_proj.weight"]
    ck, ar, out = tmp_path / "c.safetensors", tmp_path / "arch.json", tmp_path / "weights"
    write_ckpt(ck, t)
    write_arch(ar)
    with pytest.raises(ValueError, match="c_proj"):
        bw.main([str(ck), str(ar), str(out)])
    assert not out.exists() or list(out.iterdir()) == []
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".") or p.suffix == ".tmp"]


def test_layer_file_size_budget():
    rnd = random.Random(3)
    big = f32([rnd.gauss(0, 0.1) for _ in range(1024 * 256)])
    sq = f32(big[: 256 * 256])
    mats = []
    for s in "ab":
        for q in "qkvo":
            mats.append(bw.matrix_summary(f"stream_{s}.attn.{q}_proj.weight", sq, [256, 256], 0.0153))
        mats.append(bw.matrix_summary(f"stream_{s}.moe.gate.weight", f32(big[: 12 * 256]), [12, 256], None))
    for e in range(12):
        mats.append(bw.matrix_summary(f"experts.{e}.c_fc.weight", big, [1024, 256], 0.0153))
        mats.append(bw.matrix_summary(f"experts.{e}.c_proj.weight", big, [256, 1024], 0.0153))
    mats.append(bw.matrix_summary("anastomosis.0.gate.weight", f32(big[: 2 * 512]), [2, 512], None))
    vec = [bw.vector_summary(f"experts.{e}.seed_bias", f32(big[:256]), [256]) for e in range(12)]
    text = bw.dumps({"layer": 0, "tau": 0.0153, "fusion": True, "matrices": mats, "vectors": vec})
    assert len(text.encode()) < 130_000
