"""Generate src/data/about.json (the project record shown in the About) from the repo docs.

Usage: python3 -I build_about.py REPO_ROOT OUT

Reads the last recorded training state and the surgery counts from
albert-moe-13/README.md, cross-checks the surgery totals and the last surgery against
albert-moe-13/docs/SURGERY_REGISTRY.md, reads the context length from MODEL_CARD.md, and takes the two links from the root README.md.
Anything that is missing or disagrees raises ValueError and nothing is written.
"""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

REPO_URL = r"https://github\.com/rfi-irfos/ternary-intelligence-stack(?=[/)\s\"'])"
HF_URL = r"https://huggingface\.co/rfi-irfos/albert(?=[)\s\"'])"


def _one(rx, text, what, flags=0):
    m = re.search(rx, text, flags)
    if not m:
        raise ValueError(f"not found in docs: {what}")
    return m


def parse(readme, registry, root_readme, model_card):
    state = _one(
        r"Global Epoch \*\*(\d+)\*\* · loss_avg \*\*([\d.]+)\*\* · loss_best \*\*([\d.]+)\*\*"
        r" \(source: `epoch_history\.log`, last write (\d{4}-\d\d-\d\d)",
        readme, "training state line",
    )
    surg = _one(
        r"Surgery log — (\d+) Net2Net depth surgeries \((\d+)L→(\d+)L\) \+ (\d+) cord surgery", readme, "surgery counts"
    )
    totals = _one(
        r"Totals as of [\d-]+:\*{0,2} (\d+) depth surgeries \((\d+)L→(\d+)L\) \+ (\d+) cord surgery\. "
        r"Training stopped at epoch (\d+) \(loss_avg ([\d.]+), loss_best ([\d.]+)\)",
        registry, "registry totals",
    )
    reg = (totals[1], totals[2], totals[3], totals[4])
    rd = (surg[1], surg[2], surg[3], surg[4])
    if reg != rd:
        raise ValueError(f"surgery counts differ: README {rd} vs registry {reg}")
    if (totals[5], totals[6], totals[7]) != (state[1], state[2], state[3]):
        raise ValueError("training state differs between README and registry")
    last = None
    for line in registry.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and re.fullmatch(r"S\d+", cells[0]):
            tr = [c for c in cells if re.fullmatch(r"\d+L→\d+L", c)]
            dt = [re.match(r"\d{4}-\d\d-\d\d", c) for c in cells]
            if tr:
                a, b = (int(x) for x in re.findall(r"\d+", tr[0]))
                d = next((m.group(0) for m in dt if m), None)
                last = {"id": cells[0], "from_layers": a, "to_layers": b, "date": d}
    if not last or not last["date"]:
        raise ValueError("last surgery row not found in registry")
    if last["to_layers"] != int(surg[3]):
        raise ValueError("last surgery does not end at the documented depth")
    ctx = _one(r"\| Context length \| \*\*(\d+) tokens\*\*", model_card, "context length")
    return {
        "schema": 1,
        "context": int(ctx[1]),
        "training": {
            "epoch": int(state[1]),
            "loss_avg": float(state[2]),
            "loss_best": float(state[3]),
            "log_date": state[4],
            "source": "albert-moe-13/README.md (Training state, from epoch_history.log)",
        },
        "surgeries": {
            "depth": int(surg[1]),
            "cord": int(surg[4]),
            "from_layers": int(surg[2]),
            "to_layers": int(surg[3]),
            "last": last,
            "source": "albert-moe-13/docs/SURGERY_REGISTRY.md (Totals)",
        },
        "links": {
            "repo": _one(REPO_URL, root_readme, "repository link").group(0),
            "huggingface": _one(HF_URL, root_readme, "Hugging Face link").group(0),
        },
    }


def build(root):
    root = Path(root)
    return parse(
        (root / "albert-moe-13/README.md").read_text(),
        (root / "albert-moe-13/docs/SURGERY_REGISTRY.md").read_text(),
        (root / "README.md").read_text(),
        (root / "MODEL_CARD.md").read_text(),
    )


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print("usage: build_about.py REPO_ROOT OUT", file=sys.stderr)
        return 2
    data = build(argv[0])
    out = Path(argv[1])
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=out.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, out)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
