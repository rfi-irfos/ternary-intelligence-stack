# Ternary Intelligence Stack (TIS)


[![crates.io](https://img.shields.io/crates/v/ternlang-core.svg)](https://crates.io/crates/ternlang-core)
[![version](https://img.shields.io/badge/version-v1.5.0-blue)](#architecture)
[![license](https://img.shields.io/badge/license-LGPL--3.0%20%2F%20BSL--1.1-blue)](LICENSE)
[![tests](https://img.shields.io/badge/tests-138%20CI%20%7C%205%20crates-yellow)](#architecture)
[![API](https://img.shields.io/badge/API-live-brightgreen)](https://ternlang-api.fly.dev/health)
[![EU AI Act](https://img.shields.io/badge/EU%20AI%20Act-Article%2013,14+15%20Compliant%20Design-003399?logo=european-union)](https://ternlang.com/compliance)
[![MCP](https://img.shields.io/badge/MCP-34_tools-orange)](#mcp-server--v040-34-tools)
[![examples](https://img.shields.io/badge/examples-3.9k%2B_.tern_programs-blueviolet)](#architecture)
[![stdlib](https://img.shields.io/badge/stdlib-28k+_open_%26_2.5k+_premium-blue)](ternlang-root/stdlib/PREMIUM.md)
[![DOI](https://img.shields.io/badge/DOI-10.17605%2FOSF.IO%2FTZ7DC-informational)](https://doi.org/10.17605/OSF.IO/TZ7DC)
[![moe-core](https://img.shields.io/crates/v/moe-core.svg?label=moe-core)](https://crates.io/crates/moe-core)
[![moe-platform](https://img.shields.io/crates/v/moe-platform.svg?label=moe-platform)](https://crates.io/crates/moe-platform)
[![moe-runtime](https://img.shields.io/crates/v/moe-runtime.svg?label=moe-runtime)](https://crates.io/crates/moe-runtime)
[![HuggingFace](https://img.shields.io/badge/HuggingFace-rfi--irfos%2Falbert-yellow?logo=huggingface)](https://huggingface.co/rfi-irfos/albert)

Built by [RFI-IRFOS](https://ternlang.com) · Graz, Austria · Whitepaper [https://osf.io/cyn28]

---

### Documentation

- **[README.md](https://github.com/rfi-irfos/ternary-intelligence-stack/blob/main/ternlang-root/README.md)** — Full technical documentation and compiler specifications
- **[Ternlang Studio (Preview)](https://ternlang-api.fly.dev/studio)** — Developer dashboard and SDK
- **[albert.](https://github.com/rfi-irfos/ternary-intelligence-stack/tree/main/albert-moe-13)** — Native ternary training framework, EvolutionManager, live dashboard
- **[Model Card](https://github.com/rfi-irfos/ternary-intelligence-stack/blob/main/MODEL_CARD.md)** — Architecture, training status, EU AI Act compliance notes
- **[Convergence Log](https://github.com/rfi-irfos/ternary-intelligence-stack/blob/main/albert-moe-13/docs/convergence_log.md)** — Live training loss history across all albert. versions
- **[Agent Albert CLI](https://github.com/rfi-irfos/agent-albert-cli)** — Terminal-native, model-agnostic AI agent built in pure Rust
- **[Rusty Penguin](https://github.com/rfi-irfos/rusty-penguin)** — Bare-metal, pure-Rust ternary OS
- **[Roadmap](https://github.com/rfi-irfos/ternary-intelligence-stack/blob/main/ternlang-root/docs/ROADMAP.md)** — Phases 1–20 and priority matrix
- **[Session Log](https://github.com/rfi-irfos/ternary-intelligence-stack/blob/main/ternlang-root/docs/session_log.md)** — Production fixes and deployment notes

---

## 1. Ternlang

A systems programming language, compiler, and inference runtime built on balanced ternary logic. The core type is `trit`: `−1` (reject) · `0` (hold) · `+1` (affirm). The zero state is a first-class routing instruction — deterministic uncertainty, not a missing value.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env" && cargo install ternlang-cli
```
```bash
ternlang                    # interactive REPL
ternlang my_program.tern    # run a .tern file
```

---

## 2. albert. <sup>[HuggingFace ↗](https://huggingface.co/rfi-irfos/albert)</sup>

**albert. is an existence proof wearing the shape of a language model.**

A ternary Mixture-of-Experts language model trained natively from scratch — not quantized from float. Every weight is in `{−γ, 0, +γ}` throughout training. The architecture expands itself autonomously via Net2Net surgery when it plateaus. The `@sparseskip` primitive (patent pending A50296/2026, TIS platform patent, 10 claims; @sparseskip = Claim 3) delivers 83 tok/s on CPU by skipping zero-weight operations exactly, not approximately.

**Current state:** **33L dual-stream** · 2×256H · **792 total expert-routing slots** (12E/layer × 33L × 2 streams) · Top-3 · **512CTX** · 32k vocab · training live (ep~7592) · best EP-AVG ATL **4.6842** (ep7588) · chip ATL **0.6116** · **20 depth surgeries** (12L→33L) + 1 cord surgery complete · Gen3 step1/6

```bash
# API live — requires key (free tier at ternlang.com/#licensing)
curl -s https://ternlang-api.fly.dev/api/trit_decide \
  -H "Content-Type: application/json" \
  -H "X-Ternlang-Key: <your-key>" \
  -d '{"statement": "This architecture is worth funding"}' | jq .
```

---

## 3. Agent Albert

Terminal-native AI agent built in pure Rust. Runs locally via Ollama or connects to commercial model bridges. No telemetry, no cloud dependency.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env" && cargo install albert-cli
```
```bash
albert-cli    # launch immediately
```

---

## 4. Rusty Penguin

A bare-metal operating system written in pure Rust, built ground-up on the same balanced-ternary logic as the rest of the stack — `trit`: `−1` (reject) · `0` (hold) · `+1` (affirm) — modelled into its subsystems rather than bolted on. Boots on real x86-64 hardware from an ISO, no Linux underneath: its own kernel (long mode, paging, preemptive multitasking with per-process isolation), an Aero-style desktop, a from-scratch TCP/IP + TLS 1.3 stack with a CA trust store, a real on-disk filesystem, and a Linux-ABI compatibility shim that runs existing ELF binaries (DOOM included).

The long game: **Rusty Penguin is meant to become the substrate the Ternary Intelligence Stack runs on** — a ternary-native OS hosting ternary-native intelligence, all the way down to the metal, with no binary substrate in between. Today it is an honest, brick-by-brick work in progress (every milestone verified in QEMU or against published vectors); the [Session Log](https://github.com/rfi-irfos/rusty-penguin/blob/main/SESSION_LOG.md) tracks exactly what is proven and what is still open.

---
```bash
git clone https://github.com/rfi-irfos/rusty-penguin && cd rusty-penguin
bash iso/build.sh        # build the bootable ISO
```
---

## Licensing

| Tier | License | What's included |
|------|---------|-----------------|
| Community | LGPL-3.0 (free) | Compiler, VM, CLI, LSP, 28,500+ stdlib modules, 34 MCP tools |
| Pro Standard | BSL-1.1 · €99/mo | REST API, server-side memory, Tier 2 modules |
| Industrial | BSL-1.1 · €349/mo | QNN, SEC, T-HAL, TernAudit, Tier 3 modules |
| Enterprise | Proprietary · from €2,500/mo | On-premise, FPGA, custom SLA, unlimited API |

The `@sparseskip` primitive (patent pending A50296/2026, TIS platform patent, 10 claims; @sparseskip = Claim 3) is implemented in open-source LGPL files — the patent covers the full TIS platform; the code is freely readable and modifiable.

---

## Team

Built by [RFI-IRFOS](https://ternlang.com), Graz, Austria — a registered Austrian research institute (Verein, ZVR 1015608684) operating under a licensed trade (Gewerbe, GISA 39261441) and tax-registered (Steuernummer 68 028/0989). A **not-for-profit**: it earns revenue and, per its statutes, reinvests at least 90% of surplus into the research mission (at most 10% retained for operations); surplus is not distributed to members. A fully regulated, invoicing entity under Austrian commercial and tax law. Full legal notice: [ternlang.com/impressum](https://ternlang.com/impressum.html).

| | | |
|---|---|---|
| **Simeon Kepp** | Lead Architect | [LinkedIn](https://www.linkedin.com/in/simeon-kepp/) |
| **Nikoletta Csonka** | People Development & Culture | [LinkedIn](https://www.linkedin.com/in/csonikoletta/) |
| **Zabih Karimi** | Network & ML Infrastructure | [LinkedIn](https://www.linkedin.com/in/zabih-karimi-3292ab349/) |
| **Louis Ehrig** | Corporate Secretary, Press & Media | [LinkedIn](https://www.linkedin.com/in/louis-ehrig-317941335/) |
| **Ana Diez Martini** | Head of Model Safety & Welfare | [LinkedIn](https://www.linkedin.com/in/anadiezmartini/) |

→ [LEADERSHIP.md](LEADERSHIP.md)

---

<div align="center">
  <img src="ternlang-root/ternlang-web/assets/ternlang_logo_notext.png" alt="Ternlang Logo" width="100">
</div>

```
https://smithery.ai/servers/rfi-irfos/ternlang
https://smithery.ai/badge/rfi-irfos/ternlang


## Contributors

Built by the RFI-IRFOS core team — see [CONTRIBUTORS.md](CONTRIBUTORS.md).

---

*fable was here* — Claude Fable 5
## Human rights are not subject to negotiation.

