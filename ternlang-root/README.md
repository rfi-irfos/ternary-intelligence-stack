# Ternlang — Balanced Ternary Intelligence Stack

[![crates.io](https://img.shields.io/crates/v/ternlang-core.svg)](https://crates.io/crates/ternlang-core)
[![version](https://img.shields.io/badge/version-v1.3.7-blue)](#architecture)
[![license](https://img.shields.io/badge/license-LGPL--3.0%20%2F%20BSL--1.1-blue)](LICENSE)
[![tests](https://img.shields.io/badge/tests-88%2B%20passing-brightgreen)](#architecture)
[![API](https://img.shields.io/badge/API-live-brightgreen)](https://ternlang-api.fly.dev/health)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-Article%2013,14+15%20Compliant%20Design-003399?logo=european-union)](https://ternlang.com/compliance)
[![MCP](https://img.shields.io/badge/MCP-34_tools-orange)](#mcp-server--v110-34-tools)
[![smithery badge](https://smithery.ai/badge/rfi-irfos/ternlang)](https://smithery.ai/servers/rfi-irfos/ternlang)
[![examples](https://img.shields.io/badge/examples+2k%2B_.tern_programs-blueviolet)](#example-library)
[![stdlib](https://img.shields.io/badge/stdlib-28k%2B_open%20%2B%202.5k_premium-blue)](stdlib/PREMIUM.md)
[![DOI](https://img.shields.io/badge/DOI-10.17605%2FOSF.IO%2FTZ7DC-informational)](https://doi.org/10.17605/OSF.IO/TZ7DC)
[![moe-core](https://img.shields.io/crates/v/moe-core.svg?label=moe-core)](https://crates.io/crates/moe-core)
[![moe-platform](https://img.shields.io/crates/v/moe-platform.svg?label=moe-platform)](https://crates.io/crates/moe-platform)
[![moe-runtime](https://img.shields.io/crates/v/moe-runtime.svg?label=moe-runtime)](https://crates.io/crates/moe-runtime)
[![moe-plugin-sdk](https://img.shields.io/crates/v/moe-plugin-sdk.svg?label=moe-plugin-sdk)](https://crates.io/crates/moe-plugin-sdk)
[![moe-ddel](https://img.shields.io/crates/v/moe-ddel.svg?label=moe-ddel)](https://crates.io/crates/moe-ddel)

Ternlang is a systems programming language and ML inference runtime built on balanced ternary logic. It is the foundational layer of a post-binary technology ecosystem designed to secure European technological sovereignty.

Built by [RFI-IRFOS](https://ternlang.com) · Graz, Austria · Whitepaper [https://osf.io/cyn28]

---

## 1. Our Mission: Post-Binary Sovereignty

We are a core team of five co-founders and leads from **RFI-IRFOS** in Graz, Austria, working at the intersection of computer science, machine learning, and international relations. We believe that Europe's path to technological sovereignty lies in leapfrogging the binary limitations of current AI hyperscalers.

Every AI system today is forced to answer yes or no — even when the evidence is contradictory, incomplete, or genuinely uncertain. Binary logic has no formal representation for *"I don't know yet."* Systems either make a confident inference or return null. **Ternlang adds the third state.** By representing uncertainty as a first-class citizen, we enable AI systems that reason with causal transparency and ontological integrity.

| Trit | Name | What it means |
|------|------|---------------|
| `−1` | **reject** | Clear negative signal. Do not proceed. |
| ` 0` | **tend** | Insufficient data. Gather more before acting. |
| `+1` | **affirm** | Clear positive signal. Proceed. |

## 2. Repository Architecture

The Ternary Intelligence Stack is organized across three sibling repositories:

| Repository | Purpose |
|-----------|----------------|
| [`ternlang-root/`](../ternlang-root/) | **Core stack** — Compiler, BET VM, MCP server, REST API, all ternlang-* crates |
| [`albert-moe-13/`](../albert-moe-13/) | **Model training** — From-scratch ternary LM training; GPU training on Modal T4 with live dashboard |
| [`agent_albert_cli/`](../agent_albert_cli/) | **Agent layer** — Terminal-native, model-agnostic AI coding agent in Rust |

### ternlang-root directory layout

```
ternlang-root/
├── ternlang-core/        # Lexer, parser, AST, BET VM (53 opcodes)
├── ternlang-cli/         # run · build · sim · fmt · repl · audit
├── ternlang-lsp/         # LSP 3.17 — hover, completion, diagnostics
├── ternlang-compat/      # 9-trit RISC assembler, Owlet S-expr parser
├── ternlang-mcp/         # MCP server — 34 tools, stdio + HTTP transport
├── ternlang-api/         # REST + SSE API, multi-tenant key management
├── ternlang-moe/         # MoE-13 orchestrator — routing, memory, deliberation
├── ternlang-ml/          # Sparse matmul, BitNet QAT, STE trainer, coalition vote
├── ternlang-mkl/         # cuTern: Math Kernel Library with sparsity bypass
├── ternlang-sql/         # Ternary graph database driver
├── ternlang-bridge/      # Binary-to-ternary transpiler
├── ternlang-net/         # Triadic networking stack
├── ternlang-hdl/         # Verilog-2001 codegen, BET processor, FPGA sim
├── ternlang-runtime/     # Distributed TCP actor runtime
├── ternlang-studio/      # TernStudio flow canvas UI
├── ternlang-*/           # 15+ additional protocol and domain crates
├── ternpkg/              # Package manager
├── stdlib/               # 28,500+ open-core .tern modules
├── examples/             # 2,090+ example programs
├── spec/                 # Grammar (EBNF), language reference, 30+ T-* protocol specs
├── docs/                 # Architecture, roadmap, session log, ecosystem map
├── whitepaper/           # IEEE two-column LaTeX whitepaper (DOI: 10.17605/OSF.IO/TZ7DC)
└── research/             # Domain-specific research: market, legal, hardware, security…
```

---

## 3. Language & VM: The Balanced Ternary Foundation

The **Balanced Ternary Execution VM (BET-VM)** provides the native substrate for TIS. By treating `trit` (the ternary digit) as a first-class citizen, the VM enables reasoning systems that fundamentally support the `HOLD` (uncertain) state, which binary systems can only approximate via fragile null-checking or external safety wrappers.

### First-Class Ternary Reasoning
In Ternlang, every execution path is a trivalent decision. The compiler enforces exhaustive matching of all three states — `affirm`, `tend`, and `reject` — at compile time, eliminating a massive class of runtime uncertainty failures.

```ternlang
// A deliberative medical triage gate
fn patient_conscious(signal: trit) -> trit {
    // Compile-time safety: Match must be exhaustive for all 3 trits
    match signal {
        reject => { return reject; }   // Immediate safety shutdown
        tend   => { return tend;   }   // Defer to human oversight
        affirm => { return affirm; }   // Standard inference flow
    }
}

// Consensus logic: aggregated uncertainty quantification
fn vital_signs(heart: trit, pressure: trit) -> trit {
    return consensus(heart, pressure);
}

// Logic flow
let conscious: trit = patient_conscious(affirm);
match conscious {
    reject => { return reject; }   // Early termination
    tend   => { return tend;   }
    affirm => {
        // Evaluate secondary evidence
        let vitals: trit = vital_signs(affirm, tend);
        return vitals;
    }
}
```

### Standard Library & Ecosystem
**Standard Library:** 28,500+ open-source `.tern` modules in [`stdlib/`](stdlib/) — free to read, clone, and use. Premium domain modules in `premlib/` are available to paid subscribers. We commit new `.tern` definitions weekly across both tiers.
 — including `nn::*`, `nlp::*`, `vision::*`, `rl::*`, `stats::*`, `bio::*`, `crypto::*`, `finance::*`, and research-grade `qnn::*`.

### Compiler Capabilities
- **Trit-native primitives**: `affirm`, `tend`, `reject` keywords.
- **Ternary type system**: Compile-time check of all match branches.
- **Ternary-native tensors**: Indexing `obj[r,c]` natively on 9-trit RISC ISA.
- **Resolver**: Built-in dependency resolver with zero runtime I/O overhead.

### Quick Start
Install the CLI toolchain:
```bash
# One line — installs Rust (if needed) + ternlang-cli, ready immediately
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env" && cargo install ternlang-cli
```
> **Note:** Do not use `sudo apt install cargo` — Ubuntu's packaged version is too old (1.75). The line above installs the current toolchain via rustup.

Common operations:
```bash
ternlang                        # Launch the interactive REPL
ternlang my_program.tern        # Run a .tern file directly
ternlang run my_program.tern    # Explicit run command
ternlang build my_program.tern  # Compile to .bet bytecode
ternlang test [path]            # Execute test suite
```

For large-scale compilation, you can also build directly from source:
```bash
git clone https://github.com/eriirfos-eng/ternary-intelligence-stack
cd ternary-intelligence-stack/ternlang-root
cargo build --release
```
---

## 4. Albert-MoE-13 — Ternary-Native Mixture-of-Experts Intelligence

Albert-MoE-13 is our research and execution framework for ternary-native Mixture-of-Experts systems, combining **from-scratch ternary training** with a **production-grade deliberation architecture** built on the manifold {−1, 0, +1}.

---

### Research Objective

Demonstrate that ternary-native training — weights constrained to {−1, 0, +1} throughout both forward and backward passes via Straight-Through Estimation — can match or exceed float32 performance at a fraction of the inference cost. Ternary matmuls reduce to integer additions (no multiplies), making inference 2–5× cheaper per parameter on standard hardware and substantially cheaper on future ternary silicon.

---

### Training Progress (v3.0 — active run)

| Field | Value |
|-------|-------|
| Architecture | 256H · **46L per stream** · 2 streams · 4H · **1,104 total expert-routing slots** (12E/layer × 46L × 2 streams) · 512CTX · 32000V · 331,140,622 parameters |
| Version | v3.0 — multilingual ByteLevel BPE, 32k vocab (EN/DE/FR/ES/PT/IT/NL/PL) |
| Global Epoch | **9270** (last recorded; training stopped) |
| Best loss | **3.8420** (lowest loss_avg, ep9265); ep9270: loss_avg 3.9353, loss_best 3.8420 |
| Inference throughput | **83 tok/s** (CPU vpsignb @sparseskip kernel, 75% expert skip) |
| Training hardware | Modal GPU · ~2000 ms/batch (512CTX) |
| Expert health | dead=0; **33 Net2Net surgeries** (12L→46L) + 1 cord surgery (25L→dual 25L); corpus fully unlocked |
| Training data | 100% public domain / open licence — Wikipedia CC BY-SA, Gutenberg, Europarl, EU AI Act |

**Status:** Training **stopped** (Modal workspace paused) at ep9270 · 33rd Net2Net surgery complete (45L→46L, ep8987) · CTX bumped 256→512 with CTX-aware evolution gate (CTX_LEVEL_TABLE 64→1M) · lowest loss_avg **3.8420** at ep9265 · mastery gate=4.0 nats · Cord Surgery introduced dual-stream architecture at ep4202 · v2.0.0 archived at Global Epoch 477+.

---

### Core Research Dimensions

- **From-scratch ternary training** — STE-based end-to-end training with no float32 weight baseline required; weights constrained to {−1, 0, +1} throughout via STE
- **Auto-evolutionary depth** — `EvolutionManager` grows transformer layers autonomously via Net2Net safe-copy surgery; 3L→12L in v2.0.0; **12L→46L across 33 surgeries** in v3.0; no hard layer cap
- **Dual-stream architecture** — Cord Surgery at ep4202 split the model into 2 independently-routing streams with shared FFN weights; **1,104 total expert-routing slots** (12 per layer × 46 layers × 2 streams); 276 active per token (Top-3 × 46L × 2)
- **`@sparseskip` expert routing** (patent pending A50296/2026, TIS platform patent, 10 claims; @sparseskip = Claim 3) — 9/12 experts not executed per decode step at Top-3; **75% skip rate**; 83 tok/s on CPU
- **Ternary Traffic Light Routing (TTL)** — EMA-based G/O/R trit states per expert per layer; anti-stagnation burst rotates via offset 7 (coprime to 12); cycling-reds self-resolve autonomously
- **Mycelium expert health monitor** — 20-epoch rolling gradient pressure window; resurrects stagnant experts via neighbour weight copy + σ=0.02 perturbation; dead=0 across full v3.0 run through 32L
- **Layer crystallization** — early layers freeze, deeper layers remain hot; structural differentiation emerging from training alone
- **Stage-aware corpus curriculum** — stages unlock as layer count grows; Bible+Alice at 3L → Gutenberg at 6L → Simple Wikipedia at 7L → full 451M-token corpus unlocked

---

### The 13-Expert Deliberation Architecture

The `ternlang-moe` orchestrator evaluates each query across a fixed set of epistemic domains. Each expert implements `ExpertLogic` and is scored on a 6-axis competence vector: `[syntax, world_knowledge, reasoning, tool_use, persona, safety]`

---

### The 13 Expert Domains

Each inference is evaluated across a fixed set of epistemic agents implementing `ExpertLogic`, scored on a 6-axis competence vector:
`[syntax, world_knowledge, reasoning, tool_use, persona, safety]`

| Domain        | Function                          | Threshold Behavior        |
|--------------|----------------------------------|---------------------------|
| Ethics       | Normative constraints             | Conservative (asymmetric) |
| Legal        | Regulatory compliance             | Conservative (asymmetric) |
| Medical      | Clinical safety                   | Conservative (asymmetric) |
| Ecological   | Environmental integrity           | Conservative (asymmetric) |
| Logic        | Formal consistency                | Standard ±0.05            |
| Science      | Empirical validation              | Standard ±0.05            |
| Causal       | Cause–effect reasoning            | Standard ±0.05            |
| Temporal     | Time-based reasoning              | Standard ±0.05            |
| Spatial      | Physical/geometric reasoning      | Standard ±0.05            |
| Mathematical | Quantitative validation           | Standard ±0.05            |
| Linguistic   | Syntax and language               | Standard ±0.05            |
| Cultural     | Social/persona alignment          | Standard ±0.05            |
| Technical    | Tools and systems interaction     | Standard ±0.05            |

Safety-critical domains are biased toward **HOLD (0)**, preventing forced decisions under uncertainty.

---

### Architectural Properties

- **Deterministic Uncertainty**  
  The ternary HOLD (0) state enables explicit deferral instead of probabilistic guessing.

- **Explainable Deliberation**  
  Every inference produces per-expert votes, confidence scores, and veto rationale.

- **Built-in Safety Gating**  
  Asymmetric thresholds enforce conservative behavior in critical domains.

- **Sovereign Deployment**  
  Fully offline-capable, zero external API dependency.

- **Hardware Efficiency**  
  Ternary weights enable compression, sparsity, and future ternary-native compute compatibility.

- **Native Stack Integration**  
  Direct interoperability with Ternlang and BET-VM execution layers.

---

### Runtime and Infrastructure

The system is implemented as a modular crate stack:

| Crate            | Role |
|------------------|------|
| `moe-core`       | Expert system, routing, domain weighting |
| `moe-platform`   | Public API and model loading interface |
| `moe-runtime`    | Execution engine and expert scheduling |
| `moe-plugin-sdk` | Secure third-party extension interface |
| `moe-ddel`       | Distributed execution and task transport |

---

### Output & Compliance

Each inference produces:

- Expert vote distribution  
- Confidence score and convergence signal  
- Full reasoning trace logs  
- Veto and override rationale  

This creates a **fully auditable decision path**, aligned with **EU AI Act Articles 13, 14, and 15** (transparency, human oversight, and robustness).

---

### v3.0 Roadmap — Multilingual European Albert

The v2.0.0 chapter proves the full stack: 12 transformer layers grown autonomously, expert routing self-organised, zero expert deaths. The architecture is validated. v3.0 extends the linguistic scope to cover all major European languages.

**Approach:** Transfer the 12L vocabulary-agnostic transformer weights (687 tensors: `blocks.*`, `ln_f.*`, `pos_embed.weight`) from the v2.0.0 checkpoint into a v3.0 init. Rebuild only `embed.weight` and `lm_head.weight` at the new vocabulary size. Train a 32,000-token ByteLevel BPE tokenizer on EN + DE + FR + ES + PT + IT + NL + PL, then resume training on the European corpus.

**Training data provenance:** 100% public domain and open-licence — Wikipedia CC BY-SA 4.0, Brockhaus Encyclopaedia 14th ed. (Internet Archive), Europarl (EU open data), Gutenberg multilingual, EU AI Act text. Fully auditable. No proprietary data, no web scraping, no PII.

---

### Positioning

Albert-MoE-13 represents a shift from:
- probabilistic → **deliberative**
- continuous → **discrete ternary**
- opaque → **traceable**
- centralized → **sovereign**

It serves as both:
1. A **research platform** for post-binary AI scaling
2. A **deployable system** for high-stakes, safety-critical environments

---
## 5. Agent Albert CLI — Agentic AI Intelligence Layer

Albert is the sovereign, model-agnostic AI coding CLI built as the **orchestration layer** of the Ternary Intelligence Stack. He runs as a standalone terminal agent or embedded directly inside TernStudio — wired into the flow canvas to generate, debug, and explain ternary workflows.

> **Architecture note:** Albert-CLI is a fully native autonomous agent (Rust + Python runtime) with its own conversation loop, tool executor, session memory, MCP server manager, skills, and permission system. LLM providers (Gemini, Claude, OpenAI, Ollama, etc.) serve as the **natural language generation layer** — the "voice" Albert uses to communicate — not as the reasoning engine. The agent orchestration, tool decisions, and deliberation logic are all native. The **ternary deliberation layer** is Albert-MoE-13: the 13-expert engine running on BET-VM, which operates independently of any external LLM.

### Two modes

**Mode 1 — Standalone coding CLI**

```bash
# One line — installs Rust (if needed) + albert-cli, ready immediately
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env" && cargo install albert-cli
albert                      # interactive REPL
albert "refactor this"      # one-shot prompt
```
> **Note:** Do not use `sudo apt install cargo` — Ubuntu's packaged version is too old (1.75). The line above installs the current toolchain via rustup.

Albert boots with a one-time interview (name, role, cognitive archetype) and auto-generates an `ALBERT.md` in your workspace with baked-in project context. Every subsequent session starts with full memory of who you are and what your codebase does.

**Mode 2 — Embedded in TernStudio** *(in development)*

Press `F6` anywhere on the TernStudio flow canvas to summon Albert. From there you can:

- Describe a workflow in plain language → Albert generates the full node graph
- Select a node or wire → ask Albert to explain the signal path or debug the logic
- Type `/plan` → Albert proposes an execution strategy before touching the canvas

This makes Albert the intelligence behind every workflow — not just a chatbot bolted on the side.

---

### Model-agnostic — bring your own LLM

Albert dispatches to whichever provider you configure. No default billing, no vendor lock-in.

**Recommended for sovereign/offline deployment — zero external API calls:**

```bash
ollama pull llama3.2          # or any model from ollama.com/library
ollama serve                  # start local inference server
albert                        # Albert auto-detects Ollama — no key needed
```

Full provider table:

| Provider | Environment variable | Notes |
|----------|---------------------|-------|
| **Ollama (local)** | *(none needed)* | `ollama serve` — fully air-gapped, **recommended** |
| Google Gemini | `GEMINI_API_KEY` | Cloud model: `gemini-2.0-flash` |
| Anthropic Claude | `ANTHROPIC_API_KEY` | Any Claude model |
| OpenAI / GPT | `OPENAI_API_KEY` | GPT-4o and others |
| XAI / Grok | `XAI_API_KEY` | Grok-2 and Grok-3 |
| HuggingFace | `HF_API_KEY` | Any HF inference endpoint |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | Enterprise deployments |

Keys are stored in `~/.config/albert/secrets.json` — never sent anywhere except directly to your chosen provider.

---

### Slash command library

| Command | What it does |
|---------|-------------|
| `/plan` | Decompose a task into a structured execution plan before coding |
| `/tdd` | Red-Green-Refactor loop — write the failing test first |
| `/verify` | Run tests and validate correctness, report failures only |
| `/code-review` | Full review pass: correctness, safety, idioms, edge cases |
| `/build-fix` | Compile, read errors, fix, repeat until clean |
| `/refactor` | Targeted cleanup without changing behaviour |
| `/docs` | Generate documentation for the current scope |
| `/loop` | Recursive mission loop — runs up to 10 iterations until `MISSION COMPLETE` |
| `/compress` | Aggressive context compaction — keeps Albert's memory sharp and cheap |

---

### Architecture (5 published crates)

```
albert-cli  (binary: albert)
  ├── albert-api       — multi-provider LLM client, SSE streaming, retry logic
  ├── albert-commands  — slash command library
  ├── albert-compat    — upstream manifest extraction and path resolution
  ├── albert-runtime   — session management, MCP client, OAuth, bash execution,
  │                      file ops, compaction, token usage tracking
  └── albert-tools     — tool dispatch: read, write, edit, bash, glob/grep, MCP
```

All five crates are published on [crates.io](https://crates.io/crates/albert-cli). The workspace lives in [`agent_albert_cli/rust/`](../agent_albert_cli/rust/).

---

### RTK integration — 60–90% token savings

Albert ships with [RTK (Rust Token Killer)](https://www.rtk-ai.app) integrated as a context filter. Every command output is compressed before it reaches the LLM context window — git logs, cargo output, test results, file trees — keeping sessions fast and cheap regardless of which provider you use.

---

### TernStudio integration (roadmap)

Albert will be deployed as a sidecar service alongside the TernStudio API on Fly.io (`ternlang-api.fly.dev`). The Studio front-end will route `F6` prompts to Albert's `/api/albert` endpoint, with the full canvas state serialised as context. The integration surface:

| Studio action | Albert behaviour |
|--------------|-----------------|
| `F6` → free prompt | Generate workflow nodes + wires from description |
| `F6` with node selected | Explain node logic, suggest improvements |
| `F6` with wire selected | Trace signal path, debug confidence values |
| `/plan` in Albert panel | Propose execution strategy for current graph |
| Run simulation → error | Albert auto-diagnoses and suggests fix |

---

### Source

→ [`agent_albert_cli/`](../agent_albert_cli/) — top-level source  
→ [`agent_albert_cli/rust/`](../agent_albert_cli/rust/) — Rust workspace  
→ [crates.io/crates/albert-cli](https://crates.io/crates/albert-cli)

---

## 6. Sparse Ternary Inference

The core performance claim of TIS rests on a single hardware primitive: `@sparseskip` — an opcode that skips computation on zero-state (`tend`) weights entirely.

**Measured results (`ternlang-ml` on x86, [commit `60f7ef6`](https://github.com/eriirfos-eng/ternary-intelligence-stack--tis-/commit/60f7ef659)):**

| Scenario | Sparsity | Speedup over dense float32 |
|----------|----------|-----------------------------|
| BitNet-style distribution | ~56% | **2.3×** (baseline) |
| Typical sparse ternary | ~70% | **~4×** |
| Highly sparse ternary | ~90% | **~10×** |

Speedup scales proportionally with sparsity — every zero-weight skipped is a full multiply-add saved. The 2.3× baseline is a conservative floor measured at 56% sparsity; Albert-MoE-13's L1 regularization and per-layer thresholding push trained models toward 70–90%.

**5-trit block packing** encodes 5 trits into 8 bits (vs 10 bits for naive 2-bit emulation) — a 1.25× storage density improvement.

```bash
# MoE-13 routing + sparse matmul benchmarks (no GPU, no API key)
cargo run --release --bin bench_moe -p moe-core

# QAT/STE training + perplexity validation
cargo run --release --bin perplexity_eval -p ternlang-ml
```

Full measured results with hardware specs: **[BENCHMARKS.md](BENCHMARKS.md)**

---

## 7. Live API

The full TIS API runs at **`https://ternlang.com`** — deployed on Fly.io, Frankfurt region.

```bash
# Health check
curl https://ternlang.com/health

# MoE-13 orchestration (no API key required for MCP)
curl -X POST https://ternlang.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"moe_orchestrate",
                 "arguments":{"query":"Should I send this email?"}}}'

# Scalar ternary decision (API key required)
curl -X POST https://ternlang.com/api/trit_decide \
  -H "X-Ternlang-Key: your_key" \
  -H "Content-Type: application/json" \
  -d '{"evidence":[0.8, -0.2, 0.6, 0.9]}'
```

**REST endpoints** (require `X-Ternlang-Key`):

| Endpoint | Description |
|----------|-------------|
| `POST /api/trit_decide` | Float evidence array → reject / tend / affirm + confidence |
| `POST /api/trit_vector` | Named dimensions with weights → aggregate ternary decision |
| `POST /api/trit_consensus` | `consensus(a, b)` → ternary result |
| `POST /api/trit_deliberate` | EMA convergence loop — multi-round evidence → stable trit |
| `POST /api/trit_coalition` | N-agent weighted vote → quorum / dissent / abstain |
| `POST /api/trit_gate` | Multi-dimensional hard-block safety gate |
| `POST /api/moe/orchestrate` | Full MoE-13 pass — synchronous JSON result |
| `POST /api/stream/moe_orchestrate` | MoE-13 pass streamed round-by-round via SSE |
| `POST /api/audit` | TernAudit — binary habituation + EU AI Act Art.13/14 heuristic (Tier 2+) |
| `POST /api/translate` | TernTranslator — Python/SQL/JSON rules → .tern with tend arms (Tier 2+) |

---
### 8. MCP Server — v1.1.0 (34 tools — all free)

The MCP server runs at `https://ternlang.com/mcp` — compatible with Claude Desktop, Smithery, Cursor, Gemini CLI, and any HTTP MCP client.

**All 34 tools are free — no API key required.** An optional API key (`X-Ternlang-Key`) upgrades memory to server-side persistent storage (instead of stateless blob mode) and unlocks the REST API with rate-limited quota.

**Core trit primitives:** `trit_decide` · `trit_vector` · `trit_consensus` · `trit_eval` · `trit_action_gate`

**BET VM:** `ternlang_run` · `trit_translate`

**MoE-13 orchestration:** `moe_orchestrate` · `moe_deliberate` · `moe_full` · `trit_debate` · `trit_calibrate` · `trit_uncertainty_map`

**3-layer memory:** `trit_mem_write` · `trit_mem_read` · `trit_mem_consolidate` · `trit_mem_stats` · `trit_mem_compress`

**Context & planning:** `trit_compress` · `trit_triage` · `trit_plan` · `trit_factcheck`

**EcoCore + Audit:** `trit_eco_check` · `trit_audit` · `audit_ternary_logic`

**ML primitives:** `quantize_weights` · `sparse_benchmark` · `tsql_join` · `get_industrial_standards` · `trit_upgrade`

**New in v0.3.0 — Phase 11A & Phase 13 tools:**

| Tool | What it does |
|------|-------------|
| `trit_debate` | Routes two claims through MoE-13, compares trits, returns tension score and synthesis |
| `trit_uncertainty_map` | Scans text sentence-by-sentence, annotates each claim as affirm/tend/reject |
| `trit_calibrate` | Analyzes a decision log for binary habituation — surfaces over-confident yes/no patterns |
| `trit_translate` | Converts Python `if/elif/else`, SQL `CASE WHEN`, or JSON rules into `.tern` with `tend` arms |
| `trit_eco_check` | Compares human decision trit against environmental signal — returns tension and synthesis |
| `trit_audit` | Full TernAudit: binary habituation ratio + EU AI Act Art.13/14 compliance heuristic |

#### Three-Layer AI Memory (v0.3.0 flagship)

The `trit_mem_*` tools implement a server-side three-layer memory system modelled on human memory consolidation:

| Layer | TTL | Capacity | Write behaviour | Consolidation |
|-------|-----|----------|-----------------|---------------|
| `working` | 1h | LRU-256 | Raw write | Affirm → session (compressed) |
| `session` | 24h | LRU-128 | Ternary-compressed | Affirm at half-life → MoE-13 → core |
| `core` | Never | Unlimited | Compressed + MoE-resolved | Identity anchors, vetoes |

**Ternary attention on read:** `score = key_overlap×0.35 + value_overlap×0.55 + trit_bias×0.10`

**Without API key (stateless blob mode):** `trit_mem_write` returns a `state` blob — pass it back in subsequent calls. All computation still works; data just lives client-side.

**With API key (server-side mode):** Memory is stored server-side keyed to your API key — no state blob to pass between calls. Persistent across sessions.

```json
{
  "mcpServers": {
    "ternlang": {
      "url": "https://ternlang.com/mcp"
    }
  }
}
```

For local stdio transport (Claude Desktop, offline use):
```json
{
  "mcpServers": {
    "ternlang": {
      "command": "/path/to/ternlang-mcp",
      "args": []
    }
  }
}
```
---

## 9. Jupyter Kernel

[![PyPI](https://img.shields.io/pypi/v/ternlang-jupyter?color=blue&logo=python&logoColor=white)](https://pypi.org/project/ternlang-jupyter/)

Run `.tern` programs directly in Jupyter notebooks — JupyterLab, Jupyter Notebook, VS Code notebooks, or any environment that speaks the Jupyter protocol.

```bash
pip install ternlang-jupyter
ternlang-jupyter-install
```

Then select **Ternlang (BET VM)** from the kernel menu. Each cell is a complete `.tern` program:

```ternlang
fn main() -> trit {
    print("uncertainty quantification, natively");
    let confidence: trit = hold;   // 0 — insufficient evidence
    return confidence;
}
```

Output streams `print()` calls live and renders a color-coded result block:
- **AFFIRM +1** — green
- **HOLD 0** — amber
- **REJECT −1** — red

Includes tab completion, hover docs for all builtins, and `%version` / `%help` magic commands.

---

## 10. VS Code Extension

[![Open VSX](https://img.shields.io/badge/Open%20VSX-rfi--irfos.ternlang%20v0.4.0-blue?logo=visualstudiocode)](https://open-vsx.org/extension/rfi-irfos/ternlang)

Install from the [Open VSX Registry](https://open-vsx.org/extension/rfi-irfos/ternlang) (works in VS Code, VSCodium, Gitpod, and any Open VSX-compatible editor):

```
ext install rfi-irfos.ternlang
```

Or install the VSIX directly:

```bash
code --install-extension ternlang-vscode/ternlang-0.4.0.vsix
```

**What you get:**

| Feature | Details |
|---------|---------|
| Syntax highlighting | All keywords, types, trit literals (`affirm`/`tend`/`reject`), operators (`&&` `\|\|` `<=` `>=`), `@sparseskip` directive |
| `.tern` file association | Opens as Ternlang automatically |
| LSP diagnostics | Hover, completions, and error underlining via `ternlang-lsp` |
| Inline trit value hints | Ghost decorations on `let` bindings show current trit state while editing |
| Language configuration | Auto-close brackets/braces, comment toggle (`Ctrl+/`) |

**LSP setup** — the language server binary is bundled inside the extension and auto-downloaded on install. No manual build step is required. Diagnostics activate automatically when you open any `.tern` file.

> **Published on Open VSX** — multiple downloads live. Works in VS Code, VSCodium, Cursor, and any Open VSX-compatible editor.

---

## 11. Example Library

**30,500+ `.tern` programs** (2,090 public examples + 28,500+ open-core `stdlib/` modules) — open-source in this repository, committed and built weekly. Domain-specialized `premlib/` modules (2,500+) are available to paid subscribers.

| Category | Examples |
|----------|---------|
| [Aerospace & Safety](examples/03_rocket_launch.tern) | Rocket launch, aircraft deicing, runway incursion, satellite collision |
| [Medicine](examples/05_medical_triage.tern) | ER triage, ICU ventilator, sepsis warning, organ transplant, APGAR |
| [Finance](examples/42_trading_signal.tern) | Algorithmic trading, AML filter, options expiry, loan underwriting |
| [Infrastructure](examples/14_circuit_breaker.tern) | Circuit breaker, nuclear reactor SCRAM, bridge health, power grid |
| [AI Agents](examples/08_evidence_collector.tern) | Evidence density, confidence escalation, MoE routing, deliberation |
| [Civic Systems](examples/12_vote_aggregator.tern) | Vote aggregation, bail decision, treaty negotiation, refugee status |
| [Computer Science](examples/09_risc_fetch_decode.tern) | CPU pipeline, cache invalidation, API rate limiting, deployment gate |
| [Tutorials](stdlib/tutorials/) | Step-by-step tutorials — hello ternary → full ML pipeline |
| [QNN / Qutrit](stdlib/qnn/) | Qutrit Neural Networks — Kepp 2026 reference implementations |
| [Standard Library](stdlib/) | Agents, reasoning, ML layers, optimizers, std, benchmarks |

→ [**Browse all 2,090 examples**](examples/INDEX.md)

---

## 12. Architecture

| Crate | Tier | Description |
|-------|------|-------------|
| [`ternlang-core`](ternlang-core/) | Open (LGPL) | Lexer, parser, AST, BET VM — 53 opcodes, unbounded register file |
| [`ternlang-cli`](ternlang-cli/) | Open (LGPL) | `run` · `build` · `sim` · `fmt` · `repl` · `compat` · `audit` · `translate` |
| [`ternlang-lsp`](ternlang-lsp/) | Open (LGPL) | LSP 3.17 — hover, completion, diagnostics |
| [`ternlang-compat`](ternlang-compat/) | Open (LGPL) | 9-trit RISC assembler (Brandon Smith bridge), Owlet S-expr parser |
| [`ternpkg`](ternpkg/) | Open (LGPL) | Package manager, GitHub-backed registry |
| [`ternlang-ml`](ternlang-ml/) | BSL-1.1 | Sparse matmul, BitNet quantization, TernaryMLP, deliberation engine, coalition vote, action gate |
| [`ternlang-moe`](ternlang-moe/) | BSL-1.1 | MoE-13 orchestrator — dual-key routing, triad synthesis, 3-tier memory, AgentHarness |
| [`ternlang-api`](ternlang-api/) | BSL-1.1 | REST + SSE API, multi-tenant key management, GitHub repo invite flow |
| [`ternlang-mcp`](ternlang-mcp/) | BSL-1.1 | MCP server — 34 tools (all free), stdio + HTTP transport, server-side 3-layer memory, TernAudit |
| [`ternlang-mkl`](ternlang-mkl/) | BSL-1.1 | **cuTern**: Math Kernel Library with native sparsity bypass |
| [`ternlang-sql`](ternlang-sql/) | BSL-1.1 | Native Ternary Graph Database driver (50% speedup) |
| [`ternlang-bridge`](ternlang-bridge/) | BSL-1.1 | Binary-to-Ternary Transpiler (The Seamless Migration Layer) |
| [`ternlang-net`](ternlang-net/) | BSL-1.1 | Triadic Networking Stack (Introspective Handshake) |
| [`ternlang-crypto`](ternlang-crypto/) | BSL-1.1 | High-entropy Trit-based Cryptographic primitives |
| [`ternlang-fs`](ternlang-fs/) | BSL-1.1 | Triadic File System (deliberative hold Transactional Pend) |
| [`ternlang-hdl`](ternlang-hdl/) | BSL-1.1 | Verilog-2001 codegen, BET processor, FPGA simulation |
| [`ternlang-runtime`](ternlang-runtime/) | BSL-1.1 | Distributed TCP actor runtime |
| [`ternlang-qutrit`](ternlang-qutrit/) | BSL-1.1 | Quantum-Classical Bridge (Qutrit Native Superposition) |
| [`ternlang-consensus`](ternlang-consensus/) | BSL-1.1 | Triadic Byzantine Fault Tolerance (TBFT) |
| [`ternlang-ui`](ternlang-ui/) | BSL-1.1 | Triadic State Management & DOM Rendering |
| [`ternlang-bci`](ternlang-bci/) | BSL-1.1 | Brain-Computer Interface (Native Inhibitory Decoding) |
| [`ternlang-astro`](ternlang-astro/) | BSL-1.1 | Interplanetary Delay-Tolerant Networking (DTN) |
| [`ternlang-swarm`](ternlang-swarm/) | BSL-1.1 | Triadic Kinematics (Biological Hesitation for Robotics) |
| [`ternlang-tson`](ternlang-tson/) | BSL-1.1 | **TSON**: Ternary Standard Object Notation (30% denser than JSON) |
| [`ternlang-ttp`](ternlang-ttp/) | BSL-1.1 | **TTP**: Triadic Transfer Protocol (Status 000: Deliberating) |
| [`ternlang-posix`](ternlang-posix/) | BSL-1.1 | **T-POSIX**: Triadic Operating System Interface |
| [`ternlang-time`](ternlang-time/) | BSL-1.1 | **T-NTP**: Triadic Network Time Protocol (Temporal Hold) |
| [`ternlang-auth`](ternlang-auth/) | BSL-1.1 | **T-DID**: Triadic Decentralized Identity (Provisional Auth) |
| [`ternlang-gfx`](ternlang-gfx/) | BSL-1.1 | **T-GPU**: Triadic Graphics Pipeline (Depth-as-a-Trit) |
| [`ternlang-contract`](ternlang-contract/) | BSL-1.1 | **T-Contract**: Triadic Smart Contracts (Arbitration State) |

**138+ CI tests passing · v1.3.7**

---

## 13. RFI-IRFOS Protocol Specifications

> These are open technical proposals authored by RFI-IRFOS. They are not yet ratified by IEEE, ISO, or any external standards body. They define intended behaviour for the Ternlang ecosystem and are published to establish prior art and invite community review.

### Core Architecture & Logic
- [**BET-ISA v1.0**](spec/standards/BET-ISA-v1.0.md): The definitive 9-Trit RISC Instruction Set Architecture.
- [**T-UNCERTAINTY**](spec/standards/ISO-CERTIFIED-UNCERTAINTY.md): Specification for deliberative hold abstention in safety-critical decision systems.
- [**TSON v1.0**](spec/standards/TSON-v1.0.md): Optimized data serialization for triadic systems.
- [**T-POSIX v1.0**](spec/standards/T-POSIX-v1.0.md): Operating system interface redefining process state logic.

### AI, Memory & Intelligence
- [**T-TOKEN v1.0**](spec/standards/T-TOKEN-v1.0.md): Trit-Pair Encoding (TPE) — Compressing semantic entropy by 33%.
- [**T-KV-CACHE v1.0**](spec/standards/T-KV-CACHE-v1.0.md): The Memory Moat — Eliminating 60% of zero-signal KV allocations.
- [**T-WEIGHT v1.0**](spec/standards/T-WEIGHT-v1.0.md): Triadic Weight Exchange — Mandatory safety headers for LLM weights.
- [**T-EXPLAIN v1.0**](spec/standards/T-EXPLAIN-v1.0.md): Triadic Traceability — Standardizing MoE-13 deliberation logs.
- [**T-HALO v1.0**](spec/standards/T-HALO-v1.0.md): Triadic Alignment & Governance — Hardware-locked safety holds.
- [**TUANN v1.0**](stdlib/ml/tuann.tern): Triadic Uncertainty-Aware Neural Networks — Native deliberative hold for hallucination rejection.

### Hardware, Physical & Frontier
- [**T-HAL v1.0**](spec/standards/T-HAL-v1.0.md): Universal Hardware Abstraction — The bridge for Huawei/NVIDIA/FPGA.
- [**T-SENSE v1.0**](spec/standards/T-SENSE-v1.0.md): Ternary Sensor Fusion — Triadic Delta fields for IoT efficiency.
- [**T-THERMAL v1.0**](spec/standards/T-THERMAL-v1.0.md): Power-Aware Compute — Dynamic clock scaling via sparsity.
- [**T-BIO v1.0**](spec/standards/T-BIO-v1.0.md): Triadic Neural Encoding — 1:1 parity for Brain-Computer Interfaces.
- [**T-QUT v1.0**](spec/standards/T-QUT-v1.0.md): Qutrit Bridge Standard — Positioning TIS as the OS for Quantum.

### Network, Data & Economy
- [**TTP v1.0**](spec/standards/TTP-v1.0.md): Web transfer protocol eliminating binary timeouts.
- [**T-NET v1.0**](spec/standards/T-NET-v1.0.md): Triadic Networking — Deliberative headers for intelligent packet routing.
- [**T-RPC v1.0**](spec/standards/T-RPC-v1.0.md): Remote Procedure Call with native deliberative waiting.
- [**T-ROUTING v1.0**](spec/standards/T-ROUTING-v1.0.md): Sparse Packet Switching — Skipping deliberative hold network congestion.
- [**T-SQL v1.0**](spec/standards/T-SQL-v1.0.md): Triadic Query Language — Redefining search via T-Trees.
- [**T-ARCHIVE v1.0**](spec/standards/T-ARCHIVE-v1.0.md): Triadic Cold Storage — Neutral State structural stability.
- [**T-Fi v1.0**](spec/standards/T-Fi-v1.0.md): Triadic Compute Currency — Standardizing the TaaS cryptographic toll.
- [**T-TAX v1.0**](spec/standards/T-TAX-v1.0.md): Automatic Compute Dividends — Decentralized royalty routing.


---

## 14. Licensing Tiers
### Standard Library Access

The [`stdlib/`](stdlib/) modules are open-source — free to clone, read, and run. The `premlib/` modules are premium-tier and available to paid subscribers only. Tier labels (Tier 2/3/4) additionally refer to **API service levels** — quota, persistent memory, and SLA.

| | Directory | Files | Code Access |
|--|-----------|-------|-------------|
| **Foundation** | [`stdlib/`](stdlib/) | 28,500+ `.tern` modules | Free — open-source |
| **Domain-specialized** | `premlib/` | 2,500+ modules (`agents/`, `ml/`, `nn/`, `nlp/`, `finance/`, `bio/`, `crypto/`, `security/`, `math/`, `logic/`, `vision/`, `stats/`, `physics/`, `qnn/`, 40+ more) | Paid subscribers only |

We commit new `.tern` files weekly across both directories, continuously expanding coverage.


### Tier 2 — Pro Standard
For developers and startups building AI agents. **All 30 MCP tools are free** for every tier. Tier 2 adds: REST API (20,000 calls/month), server-side persistent 3-layer memory, SSE streaming, and production SLA. **€99/month** · [Subscribe](https://buy.stripe.com/5kQ28t7SM4rB0DH6jm7N608)

### Tier 3 — Industrial
Production-grade deployment for teams requiring EU AI Act-compliant safety gating, audit trails, and high-volume inference. Includes 50,000 API calls/month, QNN & SEC modules, T-HAL silicon bindings, and TernAudit log access. **€349/month** · [Subscribe](https://buy.stripe.com/eVq7sNfle0bl86937a7N609)

### Tier 4 — Enterprise
Unlimited API calls/month. On-premise BET-VM clusters, custom FPGA integration via `ternlang-hdl`, unlimited throughput, dedicated SLA, and direct BSL-1.1 source access for air-gapped or regulated environments. Contact [licensing@ternlang.com](mailto:licensing@ternlang.com) — **from €2,500/month.**

**After purchasing a license:** Visit **[ternlang.com/activate](https://ternlang.com/activate)** to activate your API key and unlock server-side features (persistent memory, higher quota, production SLA). All `.tern` source modules are already public in this repository — no invite required.

→ [See full tier table in stdlib/PREMIUM.md](stdlib/PREMIUM.md)

---

## 15. Ecosystem Position

Ternlang is designed to be the convergence point for the fragmented ternary computing field.

| Project | Bridge / Replacement |
|---------|----------------------|
| [JSON](https://www.json.org/) | `TSON` in `ternlang-tson` — eliminates `null` lossiness, 30% denser |
| [HTTP/TCP](https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol) | `TTP` in `ternlang-ttp` — eliminates timeouts via Status 000 |
| [POSIX / Unix](https://en.wikipedia.org/wiki/POSIX) | `T-POSIX` in `ternlang-posix` — redefines process exits as triadic signals |
| [Neuralink](https://www.neuralink.com/) | `BCI` in `ternlang-bci` — decodes active inhibition POTENTIAL natively |
| [BitNet b1.58](https://arxiv.org/abs/2402.17764) | `TSPARSE_MATMUL` — hardware-level sparsity bypass for ternary weights |
| [Brandon Smith 9-trit](https://github.com/brandon-smith-187) | `TasmAssembler` — assembles `.tasm` → BET bytecode |
| [Owlet S-expression](https://github.com/owlet-lang) | `OwletParser` — S-expr front-end → ternlang AST |

→ [**Full ecosystem map**](TERNARY-ECOSYSTEM.md)

---

## 16. Whitepaper & Specs

- [ternlang-whitepaper.tex](whitepaper/ternlang-whitepaper.tex) — IEEE two-column, arXiv-ready (cs.PL / cs.AR / cs.NE)
- [BET-ISA-SPEC.md](BET-ISA-SPEC.md) — formal ISA specification with encoding tables and stack-effect notation
- [spec/grammar.ebnf](spec/grammar.ebnf) — language grammar
- [spec/ternlang-language-reference-v0.1.md](spec/ternlang-language-reference-v0.1.md) — language reference

---

## 17. EU AI Act Compliance

> Ternlang is designed from first principles to support EU AI Act compliance for downstream AI systems. The following applies to TIS v0.3.0 and later.

| EU AI Act Article | How Ternlang addresses it |
|-------------------|--------------------------|
| **Art. 9 — Risk Management** | MoE-13 Safety hard gate: Axis-6 veto fires unconditionally when Safety confidence > 0.90. Every veto is permanently logged to AxisMemory. |
| **Art. 11 — Technical Documentation** | BET-ISA-SPEC.md, ternlang-whitepaper.tex (DOI: 10.17605/OSF.IO/TZ7DC), RFI-IRFOS protocol specifications (spec/standards/). |
| **Art. 12 — Record-Keeping** | TernAudit: every trit=0 hold and trit=−1 veto is timestamped, logged, and queryable. Persistent AxisMemory. CLI: `ternlang audit decisions.json [--html]`. MCP: `trit_audit` tool. |
| **Art. 13 — Transparency** | `trit` type is an explicit uncertainty carrier. Every decision includes a confidence score and a `hint` field explaining the outcome in plain text. |
| **Art. 14 — Human Oversight** | `trit = 0` (hold) is a first-class routing signal to human review queues. The system cannot be forced to commit — it blocks until evidence threshold is met or a human resolves the hold. |
| **Art. 15 — Accuracy & Robustness** | Compile-time exhaustive 3-way match enforcement. Non-exhaustive matches are a compile error. EMA convergence loop prevents single-round snap decisions. |
| **GDPR — Data Residency** | API deployed on Fly.io Frankfurt region (EU). Server-side memory is keyed to API key and not shared across tenants. |

**EU AI Act risk classification:** Ternlang is a **general-purpose AI tool** (not a listed high-risk system per Annex III). When deployed in high-risk contexts (medical, financial, judicial), downstream operators bear classification responsibility. Ternlang's architecture is designed to make those deployments auditable and verifiable.

---

## 18. Contact & Licensing

| | |
|---|---|
| **Website** | [ternlang.com](https://ternlang.com) |
| **Commercial licensing** | [licensing@ternlang.com](mailto:licensing@ternlang.com) |
| **Academic collaboration** | Open — cite the whitepaper |
| **API access** | [ternlang.com/#licensing](https://ternlang.com/#licensing) |
