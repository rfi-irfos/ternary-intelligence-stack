import http.server
import json
import socketserver
import os
import sys
import re
import threading
import time
import urllib.parse

# CONFIGURATION
PORT = 8899
DIRECTORY   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # albert-moe-13/
PROJECT     = DIRECTORY
_BEST_MODEL = (
    os.path.join(PROJECT, "models", "albert_v3.0.best.safetensors")
    if os.path.exists(os.path.join(PROJECT, "models", "albert_v3.0.best.safetensors"))
    else os.path.join(PROJECT, "models", "albert_v3.0.safetensors")
)
_VOCAB_FILE = os.path.join(PROJECT, "tokenizer_v3", "tokenizer_v3.json")

# Training log lives outside the repo so git ops (filter-repo, reset, clean)
# can never delete it. The dashboard URL /dashboard/training.log is remapped
# to this stable path by the handler below.
LOG_PATH       = os.path.expanduser("~/.albert/training.log")
EPOCH_HIST_PATH = os.path.expanduser("~/.albert/epoch_history.log")
os.makedirs(os.path.expanduser("~/.albert"), exist_ok=True)

_epoch_hist_lock  = threading.Lock()
_batch_hist_lock  = threading.Lock()
BATCH_HIST_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dashboard', 'batch_history.csv')
BATCH_HIST_PATH   = os.path.normpath(BATCH_HIST_PATH)
_BATCH_LOG_RE     = re.compile(r'Epoch\s+\d+\s+\(Global\s+(\d+)\),\s+Batch\s+(\d+):\s+loss\s*=\s*([\d.]+)')
BATCHES_PER_EPOCH = 300

# The server owns batch_history.csv on the Modal path (where the binary's 300 batches/epoch
# matches BATCHES_PER_EPOCH above). On --local/--contributor the per-epoch count differs
# (e.g. 30 for contributors), so albert-train computes x itself and writes the CSV directly;
# --no-batch-sync tells the server to stand down there and avoid a double-writer race.
BATCH_SYNC = '--no-batch-sync' not in sys.argv

# The chart x-coordinate is x = epoch + batch/BATCHES_PER_EPOCH, which is NOT unique
# across restarts: when training resumes from a checkpoint it RE-RUNS the current epoch
# from batch 0, producing x-values that already exist in the CSV from the interrupted run.
# A naive "x > last_x" guard silently drops every one of those points — the chart appears
# frozen even though training streams fine. We key off the RUN_START sentinel that
# train_modal.py writes at the top of each container's log: when a new run is seen, any
# CSV tail at-or-after the run's first x is stale and gets superseded by the fresh data.
_last_reconciled_run = None   # the RUN_START marker we've already trimmed against

def _parse_current_run(log_path):
    """Return (run_marker, {x: loss}) for batch lines after the LAST RUN_START sentinel.
    run_marker is the full RUN_START line (carries ts=, so each restart is distinct)."""
    run_marker = None
    run_pts = {}
    if not os.path.isfile(log_path):
        return run_marker, run_pts
    with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
        for raw in f:
            if raw.startswith('RUN_START'):
                run_marker = raw.strip()
                run_pts.clear()          # a new run supersedes earlier lines in this log
                continue
            m = _BATCH_LOG_RE.search(raw)
            if not m:
                continue
            ep, batch, loss = int(m.group(1)), int(m.group(2)), float(m.group(3))
            if not (1.0 < loss < 50.0):
                continue
            run_pts[round(ep + batch / BATCHES_PER_EPOCH, 6)] = round(loss, 4)
    return run_marker, run_pts

def _commit_batch_history():
    """Restart-safe merge of the live training.log into batch_history.csv.

    Forward case (run extends past the CSV): append the new points.
    Restart case (run re-runs an epoch already on disk): trim the stale CSV tail
    at-or-after the run's first x ONCE, then forward-append from there. This replaces
    the old monotonic 'x > last_x' guard, which dropped every re-run point and froze
    the chart after each Modal resume/preemption."""
    global _last_reconciled_run
    if not os.path.isfile(LOG_PATH):
        return
    with _batch_hist_lock:
        run_marker, run_pts = _parse_current_run(LOG_PATH)
        if not run_pts:
            return
        run_min_x = min(run_pts)

        # Load existing CSV rows + frontier.
        csv_lines = []
        csv_max_x = -1.0
        if os.path.isfile(BATCH_HIST_PATH):
            with open(BATCH_HIST_PATH, 'r', encoding='utf-8', errors='replace') as f:
                for raw in f:
                    s = raw.rstrip('\n')
                    if not s:
                        continue
                    comma = s.find(',')
                    if comma <= 0:
                        continue
                    try:
                        x = float(s[:comma])
                    except ValueError:
                        continue
                    csv_lines.append((x, s))
                    if x > csv_max_x:
                        csv_max_x = x

        is_new_run = run_marker is not None and run_marker != _last_reconciled_run

        if is_new_run and run_min_x <= csv_max_x:
            # New run re-ran an epoch already on disk — supersede the stale tail (once).
            kept     = [s for x, s in csv_lines if x < run_min_x]
            run_rows = [f'{x:.6f},{loss:.4f}' for x, loss in sorted(run_pts.items())]
            with open(BATCH_HIST_PATH, 'w', encoding='utf-8') as f:
                f.write('\n'.join(kept + run_rows) + '\n')
            _last_reconciled_run = run_marker
            return

        # Forward-only: append run points beyond the CSV frontier.
        if is_new_run:
            _last_reconciled_run = run_marker
        new_rows = [f'{x:.6f},{loss:.4f}' for x, loss in sorted(run_pts.items()) if x > csv_max_x]
        if new_rows:
            with open(BATCH_HIST_PATH, 'a', encoding='utf-8') as f:
                f.write('\n'.join(new_rows) + '\n')

def _batch_history_sync_loop():
    """Background thread: reconcile training.log → batch_history.csv every 60 s.
    Runs once immediately on start so a restart's re-run epoch is recovered at boot,
    not after a multi-minute wait."""
    while True:
        try:
            _commit_batch_history()
        except Exception:
            pass
        time.sleep(60)

if BATCH_SYNC:
    threading.Thread(target=_batch_history_sync_loop, daemon=True).start()

def _sync_epoch_history():
    """Extract EPOCH_SUMMARY lines from training.log → epoch_history.log.
    Appends only lines not already present (keyed by epoch number). Safe to call
    from multiple threads — guarded by _epoch_hist_lock."""
    if not os.path.isfile(LOG_PATH):
        return
    with _epoch_hist_lock:
        existing_epochs = set()
        if os.path.isfile(EPOCH_HIST_PATH):
            with open(EPOCH_HIST_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    m = re.match(r'^EPOCH_SUMMARY epoch=(\d+)', line)
                    if m:
                        existing_epochs.add(int(m.group(1)))
        new_lines = []
        with open(LOG_PATH, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if not line.startswith('EPOCH_SUMMARY'):
                    continue
                m = re.match(r'^EPOCH_SUMMARY epoch=(\d+)', line)
                if m and int(m.group(1)) not in existing_epochs:
                    new_lines.append(line if line.endswith('\n') else line + '\n')
        if new_lines:
            with open(EPOCH_HIST_PATH, 'a', encoding='utf-8') as f:
                f.writelines(new_lines)

def _epoch_history_sync_loop():
    """Background thread: sync epoch_history.log every 60s so gate chip is always fresh."""
    while True:
        try:
            _sync_epoch_history()
        except Exception:
            pass
        time.sleep(60)

threading.Thread(target=_epoch_history_sync_loop, daemon=True).start()


class MyceliumEngine:
    """Lazy-loading embedding space explorer with background checkpoint watching."""

    def __init__(self, model_path: str, vocab_path: str):
        self._model_path      = model_path
        self._vocab_path      = vocab_path
        self._lock            = threading.Lock()
        self._loaded          = False
        self._loading         = False
        self._watcher_started = False
        self._embeddings      = None
        self._vocab           = None
        self._id_to_tok       = None
        self._coords          = None
        self._mtime           = None
        self._load_time       = None
        self._error           = None

    def _load(self):
        import numpy as np
        from safetensors import safe_open
        model_path    = self._model_path
        current_mtime = os.path.getmtime(model_path)
        with safe_open(model_path, framework='numpy') as f:
            emb = f.get_tensor('embed.weight').astype(np.float32)
        norms = np.linalg.norm(emb, axis=1, keepdims=True)
        emb_normed = emb / np.maximum(norms, 1e-8)
        centered = emb - emb.mean(axis=0)
        cov = (centered.T @ centered) / len(centered)
        _, eigvecs = np.linalg.eigh(cov)
        pcs = eigvecs[:, ::-1][:, :3].T
        coords = (centered @ pcs.T).astype(np.float32)
        for i in range(3):
            mx = np.abs(coords[:, i]).max()
            if mx > 0:
                coords[:, i] /= mx
        with open(self._vocab_path, encoding='utf-8') as fv:
            t = json.load(fv)
        vocab     = t['model']['vocab']
        id_to_tok = {v: k for k, v in vocab.items()}
        self._vocab      = vocab
        self._id_to_tok  = id_to_tok
        self._coords     = coords
        self._mtime      = current_mtime
        self._load_time  = time.time()
        self._error      = None
        self._embeddings = emb_normed
        self._loaded     = True

    def ensure_loaded(self):
        if self._loaded:
            return
        with self._lock:
            if not self._loaded:
                self._loading = True
                try:
                    self._load()
                finally:
                    self._loading = False
                if not self._watcher_started:
                    self._watcher_started = True
                    threading.Thread(target=self._watch, daemon=True).start()

    def _watch(self):
        while True:
            time.sleep(60)
            if self._loading:
                continue
            try:
                current_mtime = os.path.getmtime(self._model_path)
            except OSError:
                continue
            if current_mtime <= (self._mtime or 0):
                continue
            self._loading = True
            try:
                self._load()
            except Exception as exc:
                self._error   = str(exc)
            finally:
                self._loading = False

    def status(self) -> dict:
        return {
            'loaded':     self._loaded,
            'loading':    self._loading,
            'mtime':      self._mtime,
            'load_time':  self._load_time,
            'vocab_size': len(self._vocab) if self._vocab else 0,
            'dims':       int(self._embeddings.shape[1]) if self._embeddings is not None else 0,
            'checkpoint': os.path.basename(self._model_path),
            'error':      self._error,
        }

    def query(self, word: str, k: int = 40) -> dict:
        import numpy as np
        self.ensure_loaded()
        embeddings = self._embeddings
        vocab      = self._vocab
        id_to_tok  = self._id_to_tok
        coords     = self._coords
        SPACE = 'Ġ'
        disp = lambda tok: tok[1:] if tok[:1] in ('Ġ', 'ġ') else tok  # strip BPE word-boundary marker — researchers never see/type it
        token_id = vocab.get(SPACE + word)
        resolved = SPACE + word
        if token_id is None:
            token_id = vocab.get(word)
            resolved = word
        if token_id is None:
            matches = [(tok, tid) for tok, tid in vocab.items()
                       if word.lower() in tok.lower()]
            if not matches:
                return {'error': f'token not found: {word!r}', 'word': word}
            matches.sort(key=lambda x: (not x[0].startswith(SPACE), -len(x[0])))
            resolved, token_id = matches[0]
        q   = embeddings[token_id]
        sim = (embeddings @ q).tolist()
        top = sorted(range(len(sim)), key=lambda i: -sim[i])[:k + 1]
        neighbors = [
            {'word': disp(id_to_tok.get(i, f'<{i}>')), 'sim': round(sim[i], 4),
             'x': float(coords[i, 0]), 'y': float(coords[i, 1]), 'z': float(coords[i, 2])}
            for i in top if i != token_id
        ][:k]
        return {
            'word':       disp(resolved),
            'center_x':  float(coords[token_id, 0]),
            'center_y':  float(coords[token_id, 1]),
            'center_z':  float(coords[token_id, 2]),
            'neighbors':  neighbors,
            'vocab_size': len(vocab),
            'dims':       int(embeddings.shape[1]),
        }


_mycelium = MyceliumEngine(_BEST_MODEL, _VOCAB_FILE)

# Cache for dynamically extended batch_history.csv
# Tuple: (csv_mtime, log_size, combined_bytes) — invalidated when either file changes.
_batch_csv_cache = None

# --cpu: redirect bare /dashboard/ to CPU-safe thresholds (10-min stale, 30-min panel).
# Passed by albert-train on contributor machines so any manual navigation still
# gets the right params even if the auto-opened browser tab is closed.
CPU_MODE = '--cpu' in sys.argv
CPU_PARAMS = 'poll_ms=2000&stale_s=600&panel_stale_s=1800'

class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """
    A SimpleHTTPRequestHandler that supports HTTP Range requests.
    This allows the dashboard to only download the 'tail' of the training log.
    """
    def _serve_log(self):
        """Serve ~/.albert/training.log with full Range support and proper 416 headers."""
        if not os.path.isfile(LOG_PATH):
            self.send_error(404, "Training log not found — is albert-train running?")
            return
        file_size = os.path.getsize(LOG_PATH)
        range_header = self.headers.get('Range', '')
        if not range_header:
            # Full file
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(file_size))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            with open(LOG_PATH, 'rb') as f:
                self.wfile.write(f.read())
            return
        m = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not m:
            self.send_error(400)
            return
        s, e = m.groups()
        if s == '':
            start = max(0, file_size - int(e))
            end   = file_size - 1
        else:
            start = int(s)
            end   = int(e) if e else file_size - 1
        if start >= file_size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{file_size}')
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        with open(LOG_PATH, 'rb') as f:
            f.seek(start)
            self.wfile.write(f.read(length))

    def _serve_epoch_history(self):
        """Serve ~/.albert/epoch_history.log with Range support — gate chip reads this on click.
        If the file is missing or stale vs training.log, rebuild it from EPOCH_SUMMARY lines first."""
        _sync_epoch_history()
        path = EPOCH_HIST_PATH if os.path.isfile(EPOCH_HIST_PATH) else os.path.join(DIRECTORY, 'epoch_history.log')
        if not os.path.isfile(path):
            self.send_error(404, "epoch_history.log not found")
            return
        file_size = os.path.getsize(path)
        range_header = self.headers.get('Range', '')
        if not range_header:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(file_size))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            with open(path, 'rb') as f:
                self.wfile.write(f.read())
            return
        m = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not m:
            self.send_error(400)
            return
        s, e = m.groups()
        start = max(0, file_size - int(e)) if s == '' else int(s)
        end   = file_size - 1 if not e else int(e)
        if start >= file_size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{file_size}')
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            self.wfile.write(f.read(length))

    def _gen_batch_history(self):
        """Serve batch_history.csv as the single source of truth.

        On any change to the CSV or the live log, reconcile the log into the CSV first
        (_commit_batch_history is restart-safe: it trims a superseded tail on a new run,
        else forward-appends), then serve the reconciled file. No more ad-hoc 'x > last_x'
        tail-append here — that guard is exactly what froze the chart on a resume."""
        global _batch_csv_cache
        csv_path = os.path.join(PROJECT, 'dashboard', 'batch_history.csv')
        try:
            csv_mtime = os.path.getmtime(csv_path) if os.path.isfile(csv_path) else 0.0
            log_size  = os.path.getsize(LOG_PATH)   if os.path.isfile(LOG_PATH)  else 0
        except OSError:
            self.send_error(500, 'stat failed')
            return
        if (_batch_csv_cache is not None and
                _batch_csv_cache[0] == csv_mtime and
                _batch_csv_cache[1] == log_size):
            body = _batch_csv_cache[2]
        else:
            # Bring the CSV current with the live log (cheap: only writes on change).
            # Skipped under --no-batch-sync, where albert-train owns the CSV directly.
            if BATCH_SYNC:
                try:
                    _commit_batch_history()
                except Exception:
                    pass
            body = b''
            if os.path.isfile(csv_path):
                with open(csv_path, 'rb') as f:
                    body = f.read()
            # Re-stat: _commit may have rewritten the file (mtime moved); cache on the new value.
            try:
                csv_mtime = os.path.getmtime(csv_path) if os.path.isfile(csv_path) else csv_mtime
            except OSError:
                pass
            _batch_csv_cache = (csv_mtime, log_size, body)
        self.send_response(200)
        self.send_header('Content-Type', 'text/csv; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _handle_server_config(self):
        body = json.dumps({'cpu_mode': CPU_MODE}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _handle_mycelium(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/mycelium/status':
            try:
                body = json.dumps(_mycelium.status()).encode()
                code = 200
            except Exception as exc:
                body = json.dumps({'error': str(exc)}).encode()
                code = 500
        else:
            params = urllib.parse.parse_qs(parsed.query)
            word   = params.get('word', [''])[0].strip()
            try:
                k = min(max(1, int(params.get('k', ['40'])[0])), 32000)
            except ValueError:
                k = 40
            if not word:
                body = json.dumps({'error': 'word parameter required'}).encode()
                code = 400
            else:
                try:
                    body = json.dumps(_mycelium.query(word, k)).encode()
                    code = 200
                except Exception as exc:
                    body = json.dumps({'error': str(exc)}).encode()
                    code = 500
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Server config API — lets dashboard self-configure without URL params
        if self.path.startswith('/api/server-config'):
            self._handle_server_config()
            return

        # Mycelium API
        if self.path.startswith('/api/mycelium'):
            self._handle_mycelium()
            return

        # Redirect bare root to dashboard — DIRECTORY is albert-moe-13/ so / is not index.html
        clean = self.path.split('?')[0].rstrip('/')
        if clean == '':
            if CPU_MODE:
                self.send_response(302)
                self.send_header('Location', f'/dashboard/?{CPU_PARAMS}')
            else:
                self.send_response(302)
                self.send_header('Location', '/dashboard/')
            self.end_headers()
            return

        # CPU mode: redirect bare /dashboard to CPU-safe URL params.
        if CPU_MODE and 'stale_s' not in self.path and 'mycelium' not in self.path:
            if clean == '/dashboard':
                self.send_response(302)
                self.send_header('Location', f'/dashboard/?{CPU_PARAMS}')
                self.end_headers()
                return

        # Serve dynamically extended batch_history.csv (bridges CSV ↔ live training.log gap)
        clean = self.path.split('?')[0]
        if clean.endswith('batch_history.csv'):
            self._gen_batch_history()
            return

        # Remap training.log URL to the stable out-of-repo path
        if clean.endswith('training.log'):
            self._serve_log()
            return

        # Remap epoch_history.log to live ~/.albert/epoch_history.log
        if clean.endswith('epoch_history.log'):
            self._serve_epoch_history()
            return
        range_header = self.headers.get('Range')
        if not range_header or not os.path.isfile(self.translate_path(self.path)):
            return super().do_GET()

        # Parse range header: e.g. "bytes=-50000" or "bytes=0-100"
        path = self.translate_path(self.path)
        file_size = os.path.getsize(path)
        
        match = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not match:
            return super().do_GET()

        start, end = match.groups()
        if start == '': # Suffix range: -50000
            start = max(0, file_size - int(end))
            end = file_size - 1
        else:
            start = int(start)
            end = int(end) if end != '' else file_size - 1

        if start >= file_size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{file_size}')
            self.end_headers()
            return

        # Send 206 Partial Content
        self.send_response(206)
        self.send_header('Content-type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:8888')
        self.end_headers()

        with open(path, 'rb') as f:
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))

    def log_message(self, format, *args):
        pass # Silence logs

def main():
    if not os.path.exists(DIRECTORY):
        os.makedirs(DIRECTORY, exist_ok=True)

    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), RangeRequestHandler) as httpd:
            print(f"--- MoE-13 v2.2 HIGH-SPEED DASHBOARD SERVER ACTIVE ---")
            print(f"URL: http://localhost:{PORT}")
            print(f"(bound to 127.0.0.1 — use ssh -L {PORT}:localhost:{PORT} for remote access)")
            httpd.serve_forever()
    except Exception as e:
        print(f"Server Fatal Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
