"""Generate public/data/architecture.json from a safetensors header + config.

Usage: python3 -I build_architecture.py CHECKPOINT CONFIG OUT

Only the safetensors header is read (plus a streamed SHA-256). From the config
only `fusion_layers` and `threshold` are used. Any tensor name that does not
match a known pattern, or any incomplete layer, raises ValueError and nothing
is written.
"""

import hashlib
import json
import os
import re
import struct
import sys
import tempfile
from pathlib import Path

NUM_HEADS = 4  # attention.rs: 4 heads x 64 dims
NUM_STREAMS = 2  # stream_a, stream_b
DEFAULT_THRESHOLD = 0.02  # config.rs default when `threshold` is absent
TAU_MIN, TAU_CAP = 0.01, 0.05

# (component, tensor-name pattern, ternary). Placeholders: {i} layer,
# {s} stream (a|b), {e} expert, {k} anastomosis gate.
SPEC = [
    ("embed", "embed.weight", False),
    ("ln1", "blocks.{i}.stream_{s}.ln1.weight", False),
    ("ln1", "blocks.{i}.stream_{s}.ln1.bias", False),
    *[("attn", f"blocks.{{i}}.stream_{{s}}.attn.{q}_proj.weight", True) for q in "qkvo"],
    ("ln2", "blocks.{i}.stream_{s}.ln2.weight", False),
    ("ln2", "blocks.{i}.stream_{s}.ln2.bias", False),
    ("router", "blocks.{i}.stream_{s}.moe.gate.weight", False),
    ("expert", "blocks.{i}.experts.{e}.c_fc.weight", True),
    ("expert", "blocks.{i}.experts.{e}.c_fc.bias", False),
    ("expert", "blocks.{i}.experts.{e}.c_proj.weight", True),
    ("expert", "blocks.{i}.experts.{e}.c_proj.bias", False),
    ("seed_bias", "blocks.{i}.experts.{e}.seed_bias", False),
    ("anastomosis", "anastomosis.{k}.gate.weight", False),
    ("anastomosis", "anastomosis.{k}.gate.bias", False),
    ("ln_f", "ln_f.weight", False),
    ("ln_f", "ln_f.bias", False),
    ("lm_head", "lm_head.weight", True),
]
COMPONENT_ORDER = [
    "embed", "ln1", "attn", "ln2", "router", "expert",
    "seed_bias", "anastomosis", "ln_f", "lm_head",
]
_PLACEHOLDERS = {"i": r"(?P<i>\d+)", "s": r"(?P<s>[ab])", "e": r"(?P<e>\d+)", "k": r"(?P<k>\d+)"}


def _compile(pattern):
    rx = re.escape(pattern)
    for key, group in _PLACEHOLDERS.items():
        rx = rx.replace(re.escape("{" + key + "}"), group)
    return re.compile(rx + r"\Z")


_COMPILED = [(c, p, t, _compile(p)) for c, p, t in SPEC]


def read_header(path):
    with open(path, "rb") as f:
        raw = f.read(8)
        if len(raw) != 8:
            raise ValueError(f"{path}: not a safetensors file")
        (n,) = struct.unpack("<Q", raw)
        body = f.read(n)
    if len(body) != n:
        raise ValueError(f"{path}: truncated safetensors header")
    header = json.loads(body)
    header.pop("__metadata__", None)
    return header


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def _numel(shape):
    n = 1
    for d in shape:
        n *= d
    return n


def _classify(header):
    """name -> (component, pattern, ternary, ids dict). Fails on unknown names."""
    out = {}
    for name in header:
        for comp, pat, tern, rx in _COMPILED:
            m = rx.match(name)
            if m:
                out[name] = (comp, pat, tern, {k: v for k, v in m.groupdict().items()})
                break
        else:
            raise ValueError(f"unknown tensor name: {name}")
    return out


def _tau_schedule(num_layers, tau_top):
    if num_layers == 1:
        return [TAU_MIN]
    return [
        min(TAU_CAP, TAU_MIN + (tau_top - TAU_MIN) * i / (num_layers - 1))
        for i in range(num_layers)
    ]


def build(checkpoint, config):
    checkpoint, config = Path(checkpoint), Path(config)
    header = read_header(checkpoint)
    cfg = json.loads(config.read_text())
    cls = _classify(header)

    # group per component / pattern
    comps = {c: {} for c in COMPONENT_ORDER}
    for name, (comp, pat, tern, ids) in cls.items():
        info = header[name]
        g = comps[comp].setdefault(
            pat, {"ternary": tern, "shape": None, "dtype": None, "keys": set()}
        )
        shape, dtype = list(info["shape"]), info["dtype"]
        if g["shape"] is None:
            g["shape"], g["dtype"] = shape, dtype
        elif g["shape"] != shape or g["dtype"] != dtype:
            raise ValueError(f"{name}: shape/dtype differs from other {pat} instances")
        g["keys"].add(tuple(sorted(ids.items())))

    # derive dimensions from the header
    layers = {int(dict(k)["i"]) for g in comps["attn"].values() for k in g["keys"]}
    layers |= {int(dict(k)["i"]) for g in comps["expert"].values() for k in g["keys"]}
    if not layers:
        raise ValueError("no transformer layers found in header")
    num_layers = max(layers) + 1
    experts = {int(dict(k)["e"]) for g in comps["expert"].values() for k in g["keys"]}
    gates = {int(dict(k)["k"]) for g in comps["anastomosis"].values() for k in g["keys"]}
    num_experts = max(experts) + 1 if experts else 0

    expected = {
        "embed": 1, "ln_f": 1, "lm_head": 1,
        "ln1": num_layers * NUM_STREAMS, "ln2": num_layers * NUM_STREAMS,
        "attn": num_layers * NUM_STREAMS, "router": num_layers * NUM_STREAMS,
        "expert": num_layers * num_experts, "seed_bias": num_layers * num_experts,
        "anastomosis": len(gates),
    }
    if layers != set(range(num_layers)):
        raise ValueError(f"layer indices not contiguous: {sorted(layers)}")
    if experts != set(range(num_experts)) or gates != set(range(len(gates))):
        raise ValueError("expert or anastomosis indices not contiguous")

    components = {}
    for comp in COMPONENT_ORDER:
        patterns = [p for c, p, _ in SPEC if c == comp]
        missing = [p for p in patterns if p not in comps[comp]]
        # attn needs all four projections; others need every listed pattern
        if missing:
            raise ValueError(f"component {comp}: missing tensors {missing}")
        tensors, ppi = [], 0
        for pat in patterns:
            g = comps[comp][pat]
            if len(g["keys"]) != expected[comp]:
                raise ValueError(
                    f"{pat}: expected {expected[comp]} tensors, found {len(g['keys'])}"
                )
            tensors.append(
                {"pattern": pat, "shape": g["shape"], "dtype": g["dtype"], "ternary": g["ternary"]}
            )
            ppi += _numel(g["shape"])
        components[comp] = {
            "instances": expected[comp],
            "params_per_instance": ppi,
            "tensors": tensors,
        }

    fusion = list(cfg["fusion_layers"])
    if len(fusion) != len(gates):
        raise ValueError(
            f"config fusion_layers has {len(fusion)} entries but checkpoint has {len(gates)} anastomosis gates"
        )

    tau_top = max(float(cfg.get("threshold", DEFAULT_THRESHOLD)), 0.03)
    taus = _tau_schedule(num_layers, tau_top)

    embed_shape = comps["embed"]["embed.weight"]["shape"]
    hidden = embed_shape[1]
    up = comps["expert"]["blocks.{i}.experts.{e}.c_fc.weight"]["shape"]
    params = sum(_numel(v["shape"]) for v in header.values())

    return {
        "schema": 1,
        "checkpoint": {
            "file": checkpoint.name,
            "bytes": checkpoint.stat().st_size,
            "sha256": sha256_file(checkpoint),
            "tensor_count": len(header),
        },
        "model": {
            "num_layers": num_layers,
            "num_streams": NUM_STREAMS,
            "num_experts": num_experts,
            "hidden": hidden,
            "ffn_inner": up[0],
            "num_heads": NUM_HEADS,
            "head_dim": hidden // NUM_HEADS,
            "vocab": embed_shape[0],
            "fusion_layers": fusion,
            "params": params,
            "tau_top": tau_top,
        },
        "layers": [
            {"index": i, "fusion": i in fusion, "tau": taus[i]} for i in range(num_layers)
        ],
        "components": components,
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 3:
        print("usage: build_architecture.py CHECKPOINT CONFIG OUT", file=sys.stderr)
        return 2
    checkpoint, config, out = argv
    data = build(checkpoint, config)  # raises before anything is written
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=out.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        os.replace(tmp, out)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
