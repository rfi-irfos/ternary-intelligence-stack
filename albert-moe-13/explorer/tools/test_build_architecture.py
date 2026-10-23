import json
import struct
from pathlib import Path

import pytest

import build_architecture as ba

FUSION = [2, 3, 5, 8, 13, 21, 34]


def synth_tensors(layers=46, experts=12, gates=7):
    t = {"embed.weight": [32000, 256]}
    for i in range(layers):
        for s in "ab":
            p = f"blocks.{i}.stream_{s}"
            for n in ("ln1", "ln2"):
                t[f"{p}.{n}.weight"] = [256]
                t[f"{p}.{n}.bias"] = [256]
            for q in "qkvo":
                t[f"{p}.attn.{q}_proj.weight"] = [256, 256]
            t[f"{p}.moe.gate.weight"] = [experts, 256]
        for e in range(experts):
            p = f"blocks.{i}.experts.{e}"
            t[f"{p}.c_fc.weight"] = [1024, 256]
            t[f"{p}.c_fc.bias"] = [1024]
            t[f"{p}.c_proj.weight"] = [256, 1024]
            t[f"{p}.c_proj.bias"] = [256]
            t[f"{p}.seed_bias"] = [256]
    for k in range(gates):
        t[f"anastomosis.{k}.gate.weight"] = [2, 512]
        t[f"anastomosis.{k}.gate.bias"] = [2]
    t["ln_f.weight"] = [256]
    t["ln_f.bias"] = [256]
    t["lm_head.weight"] = [32000, 256]
    return t


def write_ckpt(path: Path, tensors):
    header = {"__metadata__": {"format": "pt"}}
    off = 0
    for name, shape in tensors.items():
        n = 1
        for d in shape:
            n *= d
        header[name] = {"dtype": "F32", "shape": shape, "data_offsets": [off, off + 4 * n]}
        off += 4 * n
    raw = json.dumps(header).encode()
    path.write_bytes(struct.pack("<Q", len(raw)) + raw)
    return path


def write_cfg(path: Path, fusion=FUSION, **extra):
    path.write_text(json.dumps({"fusion_layers": fusion, "num_layers": 38, **extra}))
    return path


def make(tmp_path, layers=46, tensors=None, fusion=FUSION, **cfg):
    t = tensors if tensors is not None else synth_tensors(layers)
    return (
        write_ckpt(tmp_path / "c.safetensors", t),
        write_cfg(tmp_path / "c.json", fusion, **cfg),
    )


def test_counts_from_synthetic_46L(tmp_path):
    a = ba.build(*make(tmp_path))
    c = a["components"]
    assert a["model"]["num_layers"] == 46
    assert c["expert"]["instances"] == 552
    assert c["router"]["instances"] == 92
    assert c["attn"]["instances"] == 92
    assert c["anastomosis"]["instances"] == 7
    assert a["model"]["params"] == 331140622
    assert a["checkpoint"]["tensor_count"] == 3606
    assert a["model"]["fusion_layers"] == FUSION
    assert len(a["layers"]) == 46
    assert [l["index"] for l in a["layers"] if l["fusion"]] == FUSION
    assert c["seed_bias"]["instances"] == 552
    assert c["expert"]["params_per_instance"] == 1024 * 256 * 2 + 1024 + 256
    assert set(c) == {
        "embed", "ln1", "attn", "ln2", "router", "expert",
        "seed_bias", "anastomosis", "ln_f", "lm_head",
    }


def test_layer_count_follows_header(tmp_path):
    a = ba.build(*make(tmp_path, layers=3, fusion=FUSION))
    assert a["model"]["num_layers"] == 3
    assert len(a["layers"]) == 3
    assert a["components"]["expert"]["instances"] == 36


def test_unknown_tensor_fails(tmp_path):
    t = synth_tensors()
    t["blocks.0.foo.weight"] = [4]
    ck, cfg = make(tmp_path, tensors=t)
    out = tmp_path / "out.json"
    with pytest.raises(ValueError, match="blocks.0.foo.weight"):
        ba.build(ck, cfg)
    with pytest.raises(ValueError, match="blocks.0.foo.weight"):
        ba.main([str(ck), str(cfg), str(out)])
    assert not out.exists()


def test_incomplete_layer_fails(tmp_path):
    t = synth_tensors()
    del t["blocks.5.experts.3.seed_bias"]
    with pytest.raises(ValueError):
        ba.build(*make(tmp_path, tensors=t))


def test_fusion_layers_must_match_gate_count(tmp_path):
    with pytest.raises(ValueError, match="fusion"):
        ba.build(*make(tmp_path, fusion=FUSION[:6]))


def test_tau_schedule(tmp_path):
    a = ba.build(*make(tmp_path))
    assert a["layers"][0]["tau"] == pytest.approx(0.01)
    assert a["layers"][45]["tau"] == pytest.approx(0.03)
    assert a["model"]["tau_top"] == 0.03
    b = ba.build(*make(tmp_path, threshold=0.04))
    assert b["model"]["tau_top"] == 0.04
    assert all(l["tau"] <= 0.05 for l in b["layers"])


def test_ternary_flags(tmp_path):
    c = ba.build(*make(tmp_path))["components"]
    flags = {
        k: {t["pattern"]: t["ternary"] for t in v["tensors"]} for k, v in c.items()
    }
    assert all(flags["attn"].values()) and len(flags["attn"]) == 4
    assert flags["expert"]["blocks.{i}.experts.{e}.c_fc.weight"]
    assert flags["expert"]["blocks.{i}.experts.{e}.c_proj.weight"]
    assert not flags["expert"]["blocks.{i}.experts.{e}.c_fc.bias"]
    assert not flags["expert"]["blocks.{i}.experts.{e}.c_proj.bias"]
    assert all(flags["lm_head"].values())
    for k in ("embed", "ln1", "ln2", "router", "anastomosis", "seed_bias", "ln_f"):
        assert not any(flags[k].values()), k


def test_cli_writes_atomically(tmp_path):
    ck, cfg = make(tmp_path, layers=3)
    out = tmp_path / "o" / "a.json"
    out.parent.mkdir()
    ba.main([str(ck), str(cfg), str(out)])
    d = json.loads(out.read_text())
    assert d["schema"] == 1 and d["checkpoint"]["file"] == "c.safetensors"
    assert len(d["checkpoint"]["sha256"]) == 64
    assert [p.name for p in out.parent.iterdir()] == ["a.json"]
