# Ternlang Licensing Guide

Ternlang uses a **four-tier monetization model** to bridge open-source accessibility with industrial sovereignty.

## TL;DR

| Your Scenario | License | Cost | Action |
|---|---|---|---|
| **Personal use / learning** | LGPL-3.0 or BSL-1.1 | Free | ✅ Go ahead |
| **Academic research** | LGPL-3.0 or BSL-1.1 | Free | ✅ Cite [whitepaper](https://doi.org/10.17605/OSF.IO/TZ7DC) |
| **Startups / Small Teams** | BSL-1.1 | €99/mo | ✅ Subscribe Tier 2 |
| **Industrial / Scale** | BSL-1.1 | €349/mo | ✅ Subscribe Tier 3 |
| **Enterprise / Hardware** | Proprietary | from €2,500/mo | ❌ Contact RFI-IRFOS |

## Tier 1: Open Core (LGPL-3.0)

**What:** Language, compiler, VM, LSP, package manager  
**Crates:** `ternlang-core`, `ternlang-cli`, `ternlang-lsp`, `ternlang-compat`, `ternpkg`  
**License:** GNU Lesser General Public License v3.0

### What you can do:
- ✅ Use for any purpose
- ✅ Modify source code
- ✅ Redistribute (with source)
- ✅ Use in SaaS/proprietary software*
- ✅ Write `.tern` programs freely

---

## Tier 2: Pro (Business Source License 1.1)

**Target:** Smaller development teams.  
**Cost:** €99/month.  
**Includes:**
- 20,000 API requests/month.
- Access to `ternlang-ml` and `ternlang-mcp`.
- Sparse acceleration.

---

## Tier 3: Industrial (Business Source License 1.1)

**Target:** Industrial deployments and high-mass AI clusters.  
**Cost:** €349/month.  
**Includes:**
- 50,000 API requests/month.
- **Full Ecosystem Access**: QNN, SEC, REASONING, and T-HAL bindings.
- Priority TaaS routing.

---

## Tier 4: Enterprise (Proprietary)

**Target:** Global corporations and hardware manufacturers.  
**Cost:** from €2,500/month, with a custom SLA.  
**Includes:**
- Unlimited TaaS throughput.
- Custom triadic kernel development.
- On-premises BET-VM cluster support.
- Contact: licensing@ternlang.com

---

## Free vs. Licensed Endpoints (Hosted API)

**Tier 1 (Free):**
- 10 basic MCP tools, no authentication required.
- Rate limit: 100 calls/day.

**Tier 2 (Pro):**
- 20,000 calls/month (€99/month).
- Performance optimizations unlocked.

**Tier 3 (Industrial):**
- 50,000 calls/month (€349/month).
- Full premium stdlib (250+ modules) unlocked.

---

## ML Training Restriction

### ⚠️ CRITICAL

**The contents of this repository may not be used to train, fine-tune, or distill machine learning models without explicit written permission from RFI-IRFOS.**

---

*Last updated: 2026-04-07*
