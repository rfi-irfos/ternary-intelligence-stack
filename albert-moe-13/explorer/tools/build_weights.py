"""Generate public/data/weights/{embed,lm_head,L0..L{n-1}}.json (spec 6.4).

Usage: python3 build_weights.py CHECKPOINT ARCHITECTURE_JSON OUT_DIR

Layer count, per-layer tau, fusion layers and expert count come from
architecture.json (build_architecture.py). The checkpoint is mmap'ed and read
one tensor at a time as a zero-copy float32 view. Stdlib only. Every needed
tensor is checked against the header before any file is written, and all
files are staged in a temp directory and moved into OUT_DIR only when every
file was built (a missing tensor raises ValueError and writes nothing).
"""

import json
import mmap
import os
import shutil
import sys
import tempfile
from array import array
from bisect import bisect_right
from collections import Counter
from itertools import repeat
from math import sqrt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # works under python -I
from build_architecture import read_header  # noqa: E402

TILE = 32
BINS = 256
# lm_head threshold: transformer.rs:146-147 builds the lm_head with
# `config.threshold` (the raw value, NOT layer_threshold(i)). No loader
# overrides it (albert_serve.rs:193-205 and train_bible.rs:1276-1285 only set
# sizes, streams and fusion_layers from the config json; albert_v3.0.config.json
# has no `threshold`), so it stays config.rs:29 `TransformerConfig::default()`.
LM_HEAD_TAU = 0.02


def _sig6(x):
    return float(f"{x:.6g}")


def _f32(x):
    """Nearest float32, as the Rust code holds tau as f32."""
    return array("f", [x])[0]


def _histogram(w):
    lo, hi = min(w), max(w)
    width = (hi - lo) / BINS
    edges = [lo + width * (j + 1) for j in range(BINS - 1)]
    counts = [0] * BINS
    for b, c in Counter(map(bisect_right, repeat(edges), w)).items():
        counts[b] += c
    return {"min": lo, "max": hi, "counts": counts}


def matrix_summary(name, w, shape, tau):
    """Summarise one weight matrix. `w` is row-major F32; tau None = F32 display."""
    rows, cols = shape[0], shape[1]
    n = rows * cols
    if len(w) != n:
        raise ValueError(f"{name}: {len(w)} values for shape {shape}")
    gamma = sum(map(abs, w)) / n  # ste.rs:7 mean(|w|) over the whole matrix
    ternary = tau is not None
    out = {
        "name": name, "shape": list(shape), "dtype": "F32", "ternary": ternary,
        "gamma": _sig6(gamma), "tau": None,
        "frac_neg": None, "frac_zero": None, "frac_pos": None,
    }
    tr, tc = min(rows, TILE), min(cols, TILE)
    if ternary:
        t = _f32(tau)
        pos = sum(map(t.__lt__, w))  # w > tau   (ste.rs:15 w.gt(threshold))
        neg = sum(map((-t).__gt__, w))  # w < -tau (ste.rs:16 w.lt(-threshold))
        out["tau"] = _sig6(tau)
        out["frac_neg"] = round(neg / n, 4)
        out["frac_zero"] = round((n - pos - neg) / n, 4)
        out["frac_pos"] = round(pos / n, 4)
        out["tile"] = [
            "".join("+" if v > t else "-" if v < -t else "0" for v in w[r * cols : r * cols + tc])
            for r in range(tr)
        ]
    else:
        out["tile"] = [[round(v, 3) for v in w[r * cols : r * cols + tc]] for r in range(tr)]
    out["hist"] = _histogram(w)
    return out


def vector_summary(name, w, shape):
    n = len(w)
    mean = sum(w) / n
    std = sqrt(sum((x - mean) ** 2 for x in w) / n)  # population std
    return {
        "name": name, "shape": list(shape), "mean": _sig6(mean), "std": _sig6(std),
        "min": _sig6(min(w)), "max": _sig6(max(w)), "head": [round(v, 3) for v in w[:32]],
    }


def dumps(obj):
    return json.dumps(obj, separators=(",", ":"))


class Checkpoint:
    def __init__(self, path):
        self.header = read_header(path)
        with open(path, "rb") as f:
            hlen = int.from_bytes(f.read(8), "little")
            self._base = 8 + hlen
            self._mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        self._view = memoryview(self._mm)

    def require(self, name):
        if name not in self.header:
            raise ValueError(f"checkpoint is missing tensor {name}")
        if self.header[name]["dtype"] != "F32":
            raise ValueError(f"{name}: dtype {self.header[name]['dtype']}, expected F32")

    def tensor(self, name):
        self.require(name)
        info = self.header[name]
        a, b = info["data_offsets"]
        return self._view[self._base + a : self._base + b].cast("f"), info["shape"]

    def close(self):
        self._view.release()
        self._mm.close()


def _layer_plan(arch, i):
    """(file-name, tensor-name, display-name, tau-or-None) for matrices."""
    nexp = arch["model"]["num_experts"]
    tau = arch["layers"][i]["tau"]
    p = f"blocks.{i}."
    plan = []
    for s in "ab":
        for q in "qkvo":
            n = f"stream_{s}.attn.{q}_proj.weight"
            plan.append((p + n, n, tau))
        n = f"stream_{s}.moe.gate.weight"
        plan.append((p + n, n, None))
    for e in range(nexp):
        for m in ("c_fc", "c_proj"):
            n = f"experts.{e}.{m}.weight"
            plan.append((p + n, n, tau))
    fusion = arch["model"]["fusion_layers"]
    if i in fusion:
        n = f"anastomosis.{fusion.index(i)}.gate.weight"
        plan.append((n, n, None))
    vecs = [(p + f"experts.{e}.seed_bias", f"experts.{e}.seed_bias") for e in range(nexp)]
    return plan, vecs


def _build_files(ck, arch):
    """Yield (filename, json-text) pairs; checks the whole header first."""
    n_layers = arch["model"]["num_layers"]
    plans = [_layer_plan(arch, i) for i in range(n_layers)]
    for plan, vecs in plans:
        for tname, _, _ in plan:
            ck.require(tname)
        for tname, _ in vecs:
            ck.require(tname)
    ck.require("embed.weight")
    ck.require("lm_head.weight")

    for i, (plan, vecs) in enumerate(plans):
        mats = []
        for tname, dname, tau in plan:
            w, shape = ck.tensor(tname)
            mats.append(matrix_summary(dname, w, shape, tau))
            del w
        vectors = []
        for tname, dname in vecs:
            w, shape = ck.tensor(tname)
            vectors.append(vector_summary(dname, w, shape))
            del w
        doc = {
            "layer": i, "tau": arch["layers"][i]["tau"],
            "fusion": bool(arch["layers"][i]["fusion"]),
            "matrices": mats, "vectors": vectors,
        }
        yield f"L{i}.json", dumps(doc)
    for fname, tname, tau in (("embed.json", "embed.weight", None),
                              ("lm_head.json", "lm_head.weight", LM_HEAD_TAU)):
        w, shape = ck.tensor(tname)
        yield fname, dumps({"matrices": [matrix_summary(tname, w, shape, tau)]})
        del w


def build(checkpoint, architecture, out_dir):
    arch = json.loads(Path(architecture).read_text())
    out = Path(out_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(dir=out.parent, prefix=f".{out.name}.stage."))
    ck = Checkpoint(checkpoint)
    try:
        names = []
        for fname, text in _build_files(ck, arch):
            (stage / fname).write_text(text + "\n")
            names.append(fname)
        out.mkdir(parents=True, exist_ok=True)
        for fname in names:
            os.replace(stage / fname, out / fname)
        return names
    finally:
        ck.close()
        shutil.rmtree(stage, ignore_errors=True)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 3:
        print("usage: build_weights.py CHECKPOINT ARCHITECTURE_JSON OUT_DIR", file=sys.stderr)
        return 2
    names = build(*argv)
    print(f"wrote {len(names)} files to {argv[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
