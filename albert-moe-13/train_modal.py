#!/usr/bin/env python3
"""
train_modal.py — albert. GPU training on Modal

  python train_modal.py setup          # one-time: create volume, upload data + checkpoint
  modal run train_modal.py             # launch GPU training (streams logs live)
  modal run --detach train_modal.py    # same but survives terminal close
  python train_modal.py pull           # pull latest checkpoint back to local models/
  python train_modal.py bench_gpu      # build + run gpu_bench on T4, stream results

Run all commands from the albert-moe-13/ directory.
"""

import json
import os
import subprocess
import sys
import urllib.request

# ---------------------------------------------------------------------------
# CLI commands (setup / pull) — handled before Modal imports so they work
# even when modal isn't installed yet in an edge case.
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_VOL  = "albert-vol"
# Sentinel a streaming `albert-train` run's watchdog honors: while a checkpoint pull is hogging the
# connection, the silenced training stream must NOT be mistaken for a hang. Kept fresh during the
# download and removed when it ends; the watchdog only honors it while its mtime is recent.
_PULL_LOCK = os.path.join(os.path.expanduser("~/.albert"), "pull.active")

_UPLOADS = [
    # (local path relative to albert-moe-13/, remote path on volume)
    ("data/vocab_v3.json",               "/albert/data/vocab_v3.json"),
    ("data/corpus",                      "/albert/data/corpus"),
    ("data/corpus_cache.bin",            "/albert/data/corpus_cache.bin"),
    ("models/albert_v3.0.config.json",   "/albert/models/albert_v3.0.config.json"),
    ("models/albert_v3.0.meta",          "/albert/models/albert_v3.0.meta"),
    ("models/albert_v3.0.safetensors",   "/albert/models/albert_v3.0.safetensors"),
    ("models/albert_v3.0.best.safetensors", "/albert/models/albert_v3.0.best.safetensors"),
    ("models/albert_v3.0.best_loss",     "/albert/models/albert_v3.0.best_loss"),
]

_DOWNLOADS = [
    # (remote path on volume, local path)
    # NOTE: training.log and epoch_history.log are intentionally excluded —
    # albert-train streams Modal stdout directly to the local file, so the
    # local copy is always more current. Pulling these mid-run truncates the
    # file under the dashboard server's open range-request handle, crashing it.
    ("/albert/models/albert_v3.0.config.json",      "models/albert_v3.0.config.json"),
    ("/albert/models/albert_v3.0.safetensors",      "models/albert_v3.0.safetensors"),
    ("/albert/models/albert_v3.0.best.safetensors", "models/albert_v3.0.best.safetensors"),
    ("/albert/models/albert_v3.0.best_loss",        "models/albert_v3.0.best_loss"),
    ("/albert/models/albert_v3.0.meta",             "models/albert_v3.0.meta"),
    ("/albert/models/albert_v3.0.evolution",        "models/albert_v3.0.evolution"),
]


def _run(cmd: list[str]) -> int:
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=_HERE).returncode


def cmd_setup():
    print(f"[setup] creating volume {_VOL} (ok if already exists)")
    result = subprocess.run(["modal", "volume", "create", _VOL], cwd=_HERE)
    if result.returncode not in (0, 1):  # 1 = volume already exists (modal exit code)
        print(f"  WARNING: modal volume create exited {result.returncode}")

    total = len(_UPLOADS)
    for i, (local, remote) in enumerate(_UPLOADS, 1):
        local_abs = os.path.join(_HERE, local)
        if not os.path.exists(local_abs):
            print(f"  [{i}/{total}] SKIP {local} (not found)")
            continue
        size = _du(local_abs)
        print(f"\n[{i}/{total}] uploading {local}  ({size})")
        rc = _run(["modal", "volume", "put", "--force", _VOL, local, remote])
        if rc != 0:
            print(f"  ERROR: modal volume put exited {rc}")
            sys.exit(rc)

    print("\n[setup] done — run:  modal run train_modal.py")


def _pull_file(remote: str, local_abs: str, timeout_s: int = 600) -> int:
    """Download one file from the volume with a progress ticker and hard timeout."""
    import threading
    cmd = ["modal", "volume", "get", "--force", _VOL, remote, local_abs]
    print(f"  $ {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, cwd=_HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    # Ticker thread — prints a dot every 5 s so the terminal doesn't look frozen
    _done = threading.Event()
    def _tick():
        while not _done.wait(5):
            print(".", end="", flush=True)
            try: os.utime(_PULL_LOCK, None)   # keep the watchdog's pull sentinel fresh mid-download
            except OSError: pass
    threading.Thread(target=_tick, daemon=True).start()

    try:
        out, _ = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        _done.set()
        print(f"\n  ERROR: timed out after {timeout_s}s — volume may be locked by active training run")
        return 1
    finally:
        _done.set()

    if out:
        print(f"\n  {out.strip()}")
    else:
        print()
    return proc.returncode


def cmd_pull():
    print("[pull] downloading latest checkpoint from volume ...")
    print("       (dots = download in progress; large .safetensors can take several minutes)")
    # Raise the pull sentinel so a concurrent streaming run's watchdog defers its stall-kill: this
    # big download silences the training stream AND chokes the watchdog's container probe, which
    # would otherwise look exactly like a hang. The ticker keeps it fresh; finally clears it.
    os.makedirs(os.path.dirname(_PULL_LOCK), exist_ok=True)
    open(_PULL_LOCK, "w").close()
    try:
        for remote, local in _DOWNLOADS:
            local_abs = os.path.join(_HERE, local)
            print(f"\n  {remote}  ->  {local}")
            # Large safetensors files (~800 MB) get 10 minutes; small metadata files get 60 s
            timeout = 600 if remote.endswith(".safetensors") else 60
            rc = _pull_file(remote, local_abs, timeout_s=timeout)
            if rc != 0:
                if "best" in os.path.basename(remote):
                    print(f"  (skip) no best-checkpoint on volume yet — {os.path.basename(remote)} not written")
                else:
                    print(f"  WARNING: could not pull {remote} (exit {rc})")
    finally:
        try: os.remove(_PULL_LOCK)
        except OSError: pass
    print("\n[pull] done")


def _du(path: str) -> str:
    try:
        out = subprocess.check_output(["du", "-sh", path], stderr=subprocess.DEVNULL)
        return out.decode().split()[0]
    except Exception:
        return "?"


def cmd_bench_gpu():
    print("[bench_gpu] launching on Modal T4 ...")
    env = {**os.environ, "ALBERT_BENCH_GPU": "1"}
    rc = subprocess.run(
        ["modal", "run", os.path.abspath(__file__)],
        cwd=_HERE,
        env=env,
    ).returncode
    sys.exit(rc)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("setup", "pull", "bench_gpu"):
        print(__doc__)
        sys.exit(0)
    {"setup": cmd_setup, "pull": cmd_pull, "bench_gpu": cmd_bench_gpu}[sys.argv[1]]()
    sys.exit(0)


# ---------------------------------------------------------------------------
# Modal app definition — only reached when invoked via `modal run`
# ---------------------------------------------------------------------------

import modal  # noqa: E402
from modal import fastapi_endpoint

# CUDA 12.1 + cuDNN 8 devel image with Rust pre-installed.
# add_local_dir bakes moe-llm-core/ into the image; Modal detects changes
# and rebuilds only that layer — fast since it's just file copying.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install(
        "curl", "build-essential", "pkg-config",
        "libssl-dev", "libopenblas-dev", "ca-certificates",
    )
    .pip_install("fastapi[standard]")
    .run_commands(
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs "
        "| sh -s -- -y --default-toolchain stable --profile minimal",
        "/root/.cargo/bin/rustc --version",
    )
    .add_local_dir(
        _HERE,
        remote_path="/src",
        ignore=["target/", ".git/", "__pycache__/", "data/", "models/", "benchmarks/", "dashboard/"],
    )
)

# Persistent volume — corpus, checkpoints, cargo build cache, logs.
vol = modal.Volume.from_name(_VOL, create_if_missing=True)

app = modal.App("albert-training")

# Lighthouse OS control tower API endpoint.
# Routes are under /lighthouse/api/ — the /api prefix alone is wrong.
_LIGHTHOUSE_API_BASE = os.environ.get("LIGHTHOUSE_API_URL", "https://lighthouse-rfi-irfos.fly.dev/lighthouse/api")
# Ingest auth key — backend accepts LIGHTHOUSE_INBOX_KEY as x-inbox-key header.
# Set via Modal secret `lighthouse-ingest` (LIGHTHOUSE_INBOX_KEY=<value>).
_LIGHTHOUSE_INBOX_KEY = os.environ.get("LIGHTHOUSE_INBOX_KEY", "")

_NTFY_TOPIC = "albert-rfi-irfos"
_FIB_TARGETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987]


def _lighthouse_post(endpoint: str, payload: dict) -> bool:
    """POST JSON to Lighthouse API. Returns True on success."""
    try:
        url = f"{_LIGHTHOUSE_API_BASE}{endpoint}"
        data = json.dumps(payload).encode()
        hdrs = {"Content-Type": "application/json"}
        if _LIGHTHOUSE_INBOX_KEY:
            hdrs["x-inbox-key"] = _LIGHTHOUSE_INBOX_KEY
        req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        print(f"[lighthouse] POST {endpoint} failed: {e}")
        return False


def _ntfy(title: str, msg: str, priority: str = "3") -> None:
    try:
        req = urllib.request.Request(
            f"https://ntfy.sh/{_NTFY_TOPIC}",
            data=msg.encode(),
            headers={"Title": title, "Priority": priority},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


@app.function(
    image=image,
    gpu="L40S",          # 48GB (up from L4 24GB, 2026-09-16). Headroom to raise --batch-size
                         # past 1 without repeating the 2026-05-29 OOM (batch_size=1 already
                         # used ~10-12GB of the old 24GB card at CTX=512). Ramp batch_size
                         # carefully with real nvidia-smi/gpu_mem_mb() checks, not by guessing.
    timeout=23 * 3600,   # 23-hour cap
    volumes={"/vol": vol},
    # Auth'd lighthouse telemetry: the 'lighthouse-ingest' secret (LIGHTHOUSE_INBOX_KEY) is injected so
    # the metric push carries the x-inbox-key the backend requires. Re-created 2026-06-14 after the key
    # rotation that had silently broken telemetry at ep6189 (Baywatch went blind ~2 days). If you ever
    # delete the secret, remove this line too — modal 1.4.x crashes the launch on a missing from_name().
    secrets=[modal.Secret.from_name("lighthouse-ingest")],
    memory=16384,
    cpu=4.0,
)
def train(gate_diversity: float = 0.5, lb_weight: float = 0.03, stop_at_epoch: int = 0,
          div_weight: float = 0.001, lb_disable: bool = False, batch_size: int = 1):
    rust_bin = "/root/.cargo/bin"
    cuda_bin = "/usr/local/cuda/bin"
    env = {
        **os.environ,
        "PATH": f"{rust_bin}:{cuda_bin}:{os.environ.get('PATH', '')}",
        # Cache downloaded crates on volume (skip re-downloads).
        # Build artifacts go to /tmp — always fresh so source changes are never
        # silently skipped due to stale timestamps on the persistent volume.
        "CARGO_HOME":       "/vol/cargo-home",
        "CARGO_TARGET_DIR": "/tmp/cargo-target",
        "CARGO_TERM_COLOR": "never",
    }
    # train_bible picks its log path from $HOME/.albert/training.log, falling
    # back to {root}/dashboard/training.log when HOME is unset. The fallback
    # path is exactly what tail_log tails here. Unset HOME so telemetry lands
    # on the volume instead of the ephemeral container filesystem.
    env.pop("HOME", None)

    # The real workspace Cargo.toml references /ternlang-root which doesn't
    # exist on Modal. Replace it with a minimal workspace containing only
    # moe-llm-core — all that's needed to build train_bible.
    with open("/src/Cargo.toml", "w") as f:
        f.write(
            '[workspace]\n'
            'members = ["moe-llm-core"]\n'
            'resolver = "2"\n'
            '\n'
            '[workspace.package]\n'
            'version    = "1.3.6"\n'
            'edition    = "2024"\n'
            'license    = "LGPL-3.0-or-later"\n'
            'repository = "https://github.com/eriirfos-eng/ternary-intelligence-stack"\n'
            'homepage   = "https://ternlang.com"\n'
        )

    print("[modal] cargo build --release --features cuda ...")
    sys.stdout.flush()

    result = subprocess.run(
        [f"{rust_bin}/cargo", "build", "--release",
         "--features", "cuda", "--bin", "train_bible"],
        cwd="/src",
        env=env,
        capture_output=True,
        text=True,
    )
    # Always print output so errors are visible in Modal logs
    if result.stdout:
        print(result.stdout[-4000:])
    if result.stderr:
        print(result.stderr[-4000:])
    sys.stdout.flush()

    if result.returncode != 0:
        raise RuntimeError("cargo build failed")

    binary = "/tmp/cargo-target/release/train_bible"
    print(f"[modal] build OK — {binary}")

    os.makedirs("/vol/albert/models",     exist_ok=True)
    os.makedirs("/vol/albert/data",       exist_ok=True)
    os.makedirs("/vol/albert/logs",       exist_ok=True)
    os.makedirs("/vol/albert/dashboard",  exist_ok=True)
    vol.commit()

    cmd = [
        binary,
        "--root=/vol/albert",
        f"--gate-diversity={gate_diversity}",
        f"--lb-weight={lb_weight}",
        f"--div-weight={div_weight}",
        f"--batch-size={batch_size}",
    ]
    if lb_disable:
        cmd.append("--lb-disable")
    if stop_at_epoch > 0:
        cmd.append(f"--stop-at-epoch={stop_at_epoch}")
    print(f"[modal] {' '.join(cmd)}")
    sys.stdout.flush()

    import threading, time, re

    log_path = "/vol/albert/dashboard/training.log"
    epoch_hist_path = "/vol/albert/models/epoch_history.log"

    # Clear the volume log and write a RUN_START sentinel.
    # albert-train's stream loop detects this sentinel and truncates the local
    # dashboard log, keeping the frontend in sync across auto-restarts/preemptions.
    import time as _time
    with open(log_path, 'w') as _f:
        _f.write(f"RUN_START ts={int(_time.time())}\n")
    start_pos = 0

    _EPOCH_SUMMARY_RE = re.compile(
        r'^EPOCH_SUMMARY epoch=(\d+) loss_avg=([\d.]+)\s+\([^)]+\)\s+loss_best=([\d.]+)'
    )
    _CHIP_RE = re.compile(r'\bchip ([\d.]+)')
    _chip_atl_live = float("inf")  # track min batch loss across this run's log stream

    def _push_epoch_summary(epoch: int, loss_avg: float, loss_best: float, chip: float | None):
        """Persist epoch metrics to Lighthouse albert_metrics store (secret-authed ingest)."""
        payload = {
            "run_id": "main",
            "points": [{
                "epoch": epoch,
                "loss_avg": loss_avg,
                "loss_best": loss_best,
                "chip_atl": chip,
                "recorded_at": None,
            }],
        }
        _lighthouse_post("/albert/metrics/ingest", payload)

    def tail_log(proc):
        nonlocal _chip_atl_live
        while not os.path.exists(log_path):
            if proc.poll() is not None:
                return
            time.sleep(0.2)
        with open(log_path) as f:
            f.seek(start_pos)
            while True:
                line = f.readline()
                if line:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    stripped = line.strip()
                    # Track chip ATL from any line that contains "chip X.XXXX"
                    cm = _CHIP_RE.search(stripped)
                    if cm:
                        try:
                            _chip_atl_live = min(_chip_atl_live, float(cm.group(1)))
                        except ValueError:
                            pass
                    # Detect EPOCH_SUMMARY and push to Lighthouse
                    m = _EPOCH_SUMMARY_RE.match(stripped)
                    if m:
                        epoch = int(m.group(1))
                        loss_avg = float(m.group(2))
                        loss_best = float(m.group(3))
                        chip = _chip_atl_live if _chip_atl_live < float("inf") else None
                        _push_epoch_summary(epoch, loss_avg, loss_best, chip)
                else:
                    if proc.poll() is not None:
                        break
                    time.sleep(0.05)

    # --- evo-guard: validate evolution state before training starts ---
    _evo_path = "/vol/albert/models/albert_v3.0.evolution"
    _evo_ok = False
    _evo_warn = ""
    try:
        with open(_evo_path) as _ef:
            lines = _ef.readlines()
        if not lines:
            _evo_warn = "evolution file is empty"
        else:
            _fib_idx = int(lines[0].strip())
            if _fib_idx < 0 or _fib_idx >= len(_FIB_TARGETS):
                _evo_warn = (
                    f"fib_index={_fib_idx} out of bounds "
                    f"(valid 0–{len(_FIB_TARGETS)-1}); surgery gate will never fire"
                )
            else:
                _history_len = _FIB_TARGETS[_fib_idx]
                _evo_ok = True
                print(
                    f"[evo-guard] OK — fib_index={_fib_idx} "
                    f"window={_history_len} entries={len(lines)-1}"
                )
    except FileNotFoundError:
        _evo_warn = f"evolution file missing at {_evo_path}"
    except (ValueError, IndexError) as _e:
        _evo_warn = f"evolution file parse error: {_e}"

    if _evo_warn:
        print(f"[evo-guard] WARNING: {_evo_warn}", flush=True)
        _ntfy(
            "albert. EVO-GUARD WARNING",
            f"Evolution file problem before training start:\n{_evo_warn}\nSurgery gate may not fire.",
            priority="5",
        )

    # --- ntfy: announce training start ---
    import time as _t
    _ts = _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime())
    _evo_status = f"fib_index={_fib_idx} window={_history_len}" if _evo_ok else f"EVO WARN: {_evo_warn}"
    _ntfy(
        "albert. TRAINING STARTED",
        f"Modal container running — {_ts}\n{_evo_status}\ncmd: {' '.join(cmd[-3:])}",
        priority="3",
    )
    print(f"[modal] training started — ntfy sent ({_ts})", flush=True)

    proc = subprocess.Popen(cmd, env=env)
    tailer = threading.Thread(target=tail_log, args=(proc,), daemon=True)
    tailer.start()
    proc.wait()
    tailer.join(timeout=3)

    vol.commit()

    if proc.returncode not in (0, 1):
        raise RuntimeError(f"train_bible crashed (exit {proc.returncode})")

    print("[modal] run complete — pull checkpoint:  python train_modal.py pull")


@app.function(
    image=image,
    gpu="T4",
    timeout=900,          # 15 min ceiling — 15 prompts × 128 tokens is well under
    volumes={"/vol": vol},
    memory=16384,
    cpu=4.0,
)
def bench_gpu():
    rust_bin = "/root/.cargo/bin"
    cuda_bin = "/usr/local/cuda/bin"
    env = {
        **os.environ,
        "PATH": f"{rust_bin}:{cuda_bin}:{os.environ.get('PATH', '')}",
        "CARGO_HOME":       "/vol/cargo-home",
        "CARGO_TARGET_DIR": "/tmp/cargo-target",
        "CARGO_TERM_COLOR": "never",
    }
    env.pop("HOME", None)

    with open("/src/Cargo.toml", "w") as f:
        f.write(
            '[workspace]\n'
            'members = ["moe-llm-core"]\n'
            'resolver = "2"\n'
            '\n'
            '[workspace.package]\n'
            'version    = "1.3.6"\n'
            'edition    = "2024"\n'
            'license    = "LGPL-3.0-or-later"\n'
            'repository = "https://github.com/eriirfos-eng/ternary-intelligence-stack"\n'
            'homepage   = "https://ternlang.com"\n'
        )

    print("[modal] cargo build --release --features cuda --bin gpu_bench ...")
    sys.stdout.flush()

    result = subprocess.run(
        [f"{rust_bin}/cargo", "build", "--release",
         "--features", "cuda", "--bin", "gpu_bench"],
        cwd="/src",
        env=env,
        capture_output=True,
        text=True,
    )
    if result.stdout:
        print(result.stdout[-4000:])
    if result.stderr:
        print(result.stderr[-4000:])
    sys.stdout.flush()

    if result.returncode != 0:
        raise RuntimeError("cargo build failed")

    binary = "/tmp/cargo-target/release/gpu_bench"
    print(f"[modal] build OK — running benchmark ...")
    sys.stdout.flush()

    import threading
    proc = subprocess.Popen(
        [binary, "/vol/albert"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    def stream(p):
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()

    t = threading.Thread(target=stream, args=(proc,), daemon=True)
    t.start()
    proc.wait()
    t.join(timeout=5)

    if proc.returncode != 0:
        raise RuntimeError(f"gpu_bench exited {proc.returncode}")


# ---------------------------------------------------------------------------
# Lighthouse OS control tower — public training data endpoints
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    timeout=60,
    volumes={"/vol": vol},
    memory=512,
    cpu=0.5,
)
@fastapi_endpoint(method="GET", label="albert-training-log")
def training_log_endpoint():
    """Return training.log as JSON lines."""
    log_path = "/vol/albert/dashboard/training.log"
    if not os.path.exists(log_path):
        return {"error": "training.log not found"}, 404

    # Parse query params for tail/limit
    # Note: Modal web_endpoint passes request as first arg in newer versions
    # For simplicity, return last 1000 lines
    lines = []
    with open(log_path, "r") as f:
        for line in f:
            lines.append(line.rstrip("\n"))
    return {"lines": lines[-1000:], "total_lines": len(lines)}


@app.function(
    image=image,
    timeout=60,
    volumes={"/vol": vol},
    memory=512,
    cpu=0.5,
)
@fastapi_endpoint(method="GET", label="albert-batch-history")
def batch_history_endpoint():
    """Return batch_history.csv as JSON array [{x, loss}]."""
    csv_path = "/vol/albert/dashboard/batch_history.csv"
    if not os.path.exists(csv_path):
        return {"error": "batch_history.csv not found"}, 404

    points = []
    with open(csv_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                x_str, loss_str = line.split(",", 1)
                points.append({"x": float(x_str), "loss": float(loss_str)})
            except (ValueError, IndexError):
                continue
    return {"points": points, "count": len(points)}


@app.function(
    image=image,
    timeout=60,
    volumes={"/vol": vol},
    memory=512,
    cpu=0.5,
)
@fastapi_endpoint(method="GET", label="albert-epoch-history")
def epoch_history_endpoint():
    """Return epoch_history.log as JSON array."""
    hist_path = "/vol/albert/models/epoch_history.log"
    if not os.path.exists(hist_path):
        return {"error": "epoch_history.log not found"}, 404

    epochs = []
    import re as _re
    # EPOCH_SUMMARY format: epoch=829 loss_avg=10.2475 (d+0.0276) loss_best=10.2199 since_best=43...
    epoch_re = _re.compile(r'^EPOCH_SUMMARY epoch=(\d+) loss_avg=([\d.]+)\s+\([^)]+\)\s+loss_best=([\d.]+)')
    with open(hist_path, "r") as f:
        for line in f:
            m = epoch_re.match(line.strip())
            if m:
                epochs.append({
                    "epoch": int(m.group(1)),
                    "loss_avg": float(m.group(2)),
                    "loss_best": float(m.group(3)),
                })
    return {"epochs": epochs, "count": len(epochs)}


@app.function(
    image=image,
    timeout=30,
    volumes={"/vol": vol},
    memory=512,
    cpu=0.5,
)
@fastapi_endpoint(method="GET", label="albert-latest-epoch")
def latest_epoch_endpoint():
    """Return the latest epoch summary."""
    hist_path = "/vol/albert/models/epoch_history.log"
    if not os.path.exists(hist_path):
        return {"error": "epoch_history.log not found"}, 404

    import re as _re
    # EPOCH_SUMMARY format: epoch=829 loss_avg=10.2475 (d+0.0276) loss_best=10.2199 since_best=43...
    epoch_re = _re.compile(r'^EPOCH_SUMMARY epoch=(\d+) loss_avg=([\d.]+)\s+\([^)]+\)\s+loss_best=([\d.]+)')
    last = None
    with open(hist_path, "r") as f:
        for line in f:
            m = epoch_re.match(line.strip())
            if m:
                last = {
                    "epoch": int(m.group(1)),
                    "loss_avg": float(m.group(2)),
                    "loss_best": float(m.group(3)),
                }
    if last is None:
        return {"error": "no epoch summaries found"}, 404
    return last


@app.function(
    image=image,
    timeout=30,
    volumes={"/vol": vol},
    memory=512,
    cpu=0.5,
)
@fastapi_endpoint(method="GET", label="albert-training-health")
def health_endpoint():
    """Health check endpoint."""
    import time as _time
    return {
        "status": "ok",
        "service": "albert-training-data",
        "timestamp": int(_time.time()),
        "volume_files": {
            "training_log": os.path.exists("/vol/albert/dashboard/training.log"),
            "batch_history": os.path.exists("/vol/albert/dashboard/batch_history.csv"),
            "epoch_history": os.path.exists("/vol/albert/models/epoch_history.log"),
        },
    }


# ---------------------------------------------------------------------------
# CLI entrypoints
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main():
    if os.environ.get("ALBERT_BENCH_GPU"):
        bench_gpu.remote()
        return

    # Sync local config to the volume before launching — prevents silent CTX/arch drift.
    # BUT reconcile first: surgeries happen REMOTELY and in-memory, so the volume's arch can be
    # DEEPER than the stale local config. Blindly pushing local up then rolls the model back
    # (S14 incident 2026-05-29: a false-positive restart pushed local 26L over the volume's 27L,
    # silently dropping a whole layer). Rule: never let the pushed config have FEWER layers than
    # the volume already has. If the volume is deeper, adopt its arch (and keep its evolution).
    import json as _json
    _vol_deeper = False
    # FAIL-SAFE: only push local config up if we VERIFIED the volume isn't deeper. If the volume
    # read fails for ANY reason, do NOT push — an unverified push is exactly what rolled S14 back.
    _config_push_safe = True
    _cfg_local = os.path.join(_HERE, "models/albert_v3.0.config.json")
    try:
        subprocess.run(
            ["modal", "volume", "get", "--force", _VOL,
             "/albert/models/albert_v3.0.config.json", "/tmp/_albert_vol_config.json"],
            cwd=_HERE, timeout=90, check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        with open("/tmp/_albert_vol_config.json") as _f:
            _vcfg = _json.load(_f)
        with open(_cfg_local) as _f:
            _lcfg = _json.load(_f)
        _vN, _lN = int(_vcfg.get("num_layers", 0)), int(_lcfg.get("num_layers", 0))
        if _vN <= 0:
            raise ValueError(f"volume config has no usable num_layers ({_vN!r})")
        if _vN > _lN:
            _vol_deeper = True
            print(f"[main] RECONCILE: volume arch is DEEPER ({_vN}L) than local ({_lN}L) — a "
                  f"remote surgery local didn't know about. Adopting volume arch; NOT clobbering it.")
            _lcfg["num_layers"] = _vN
            with open(_cfg_local, "w") as _f:
                _json.dump(_lcfg, _f, indent=2)
    except Exception as _e:
        _config_push_safe = False
        print(f"[main] RECONCILE FAILED ({_e}) — cannot verify the volume's arch, so NOT pushing "
              f"local config (fail-safe: an unverified push is what rolled S14 back). "
              f"Volume config left untouched; resume will use whatever the volume already holds.")

    if _config_push_safe:
        print("[main] syncing config.json to volume ...")
        rc = subprocess.run(
            ["modal", "volume", "put", "--force", _VOL,
             "models/albert_v3.0.config.json",
             "/albert/models/albert_v3.0.config.json"],
            cwd=_HERE,
        ).returncode
        if rc != 0:
            raise SystemExit(f"[main] config sync failed (exit {rc}) — aborting launch")

    # Push evolution state so fib_index survives restarts — UNLESS the volume was deeper (its
    # evolution reflects a newer surgery cadence) OR reconcile failed (don't risk a stale push).
    evo_local = os.path.join(_HERE, "models/albert_v3.0.evolution")
    if _vol_deeper or not _config_push_safe:
        print("[main] keeping volume evolution state (volume newer / unverified) — not pushing local.")
    elif os.path.exists(evo_local):
        print("[main] syncing evolution state to volume ...")
        evo_rc = subprocess.run(
            ["modal", "volume", "put", "--force", _VOL,
             "models/albert_v3.0.evolution",
             "/albert/models/albert_v3.0.evolution"],
            cwd=_HERE,
        ).returncode
        if evo_rc != 0:
            print(f"[main] evolution sync failed (exit {evo_rc}) — train_bible will recalibrate from scratch")
    # batch_size=2 (up from 1, 2026-09-16, alongside the L40S 48GB upgrade). The old
    # 24GB L4 was already at ~10-12GB for batch_size=1 at CTX=512, so this is a
    # conservative first step, not a jump straight to 4 — watch the GPUMEM log lines
    # (dashboard/training.log, written every 4 batches) before raising it further.
    train.remote(gate_diversity=0.3, lb_weight=0.03, div_weight=0.001, lb_disable=False, batch_size=2)
