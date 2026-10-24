import pytest
import build_about as b

README = (
    "**Surgery log — 33 Net2Net depth surgeries (12L→46L) + 1 cord surgery:**\n"
    "Global Epoch **9270** · loss_avg **3.9353** · loss_best **3.8420** (source: `epoch_history.log`, last write 2026-09-23 03:40 local)\n"
)
REG = (
    "| S33 | 8986→8987 | not recorded | 45L→46L | 2026-09-20, 01:05Z | x |\n"
    "**Totals as of 2026-10-24:** 33 depth surgeries (12L→46L) + 1 cord surgery. Training stopped at epoch 9270 (loss_avg 3.9353, loss_best 3.8420).\n"
)
CARD = "| Context length | **512 tokens** (`max_seq_len` 512) |"
ROOT = "[a](https://github.com/rfi-irfos/ternary-intelligence-stack) [b](https://huggingface.co/rfi-irfos/albert)"


def test_parse():
    d = b.parse(README, REG, ROOT, CARD)
    assert d["training"]["epoch"] == 9270 and d["training"]["loss_best"] == 3.842
    assert d["surgeries"]["last"] == {"id": "S33", "from_layers": 45, "to_layers": 46, "date": "2026-09-20"}
    assert d["context"] == 512
    assert d["links"]["huggingface"].endswith("/albert")


def test_disagreement_fails():
    with pytest.raises(ValueError):
        b.parse(README, REG.replace("33 depth", "32 depth"), ROOT, CARD)
    with pytest.raises(ValueError):
        b.parse(README, REG, "no links", CARD)
