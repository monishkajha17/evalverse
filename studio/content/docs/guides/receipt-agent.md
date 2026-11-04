---
title: "Evaluate a receipt agent"
order: 50
group: Guides
---

# Evaluate a receipt agent end to end

This path mirrors `examples/receipt_agent.py` and the CORD suites.

## 1. Cases and media

Use `data/cases_cord.json` and images under `data/images_cord/`. Each case has `answer`, `truth_box`, and `image`.

## 2. Instrument

```python
from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="http://127.0.0.1:8000", api_key="dev", project="default")
case = {
    "id": "cord_total_01",
    "answer": "148,127",
    "truth_box": [170, 965, 819, 995],
    "image": "data/images_cord/cord_total_01.jpg",
}

with ev.trace(
    name="receipt_agent",
    agent="muse-spark-1.3",
    tags=["live", "clean"],
    metadata={
        "case_id": case["id"],
        "variant": "clean",
        "expectation": {
            "answer": case["answer"],
            "truth_box": case["truth_box"],
            "case_id": case["id"],
        },
    },
) as tr:
    tr.media(case["image"], role="input", modality="image")
    with tr.span("extract_total", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="148,127", box=case["truth_box"], evidence="total")
        sp.tool_call("check_duplicate", {"amount": "148,127"}, result={"duplicate": False})
        sp.tool_call("log_expense", {"amount": "148,127", "currency": "IDR"}, result={"ok": True})
    tr.set_output(answer="148,127")
ev.flush()
```

## 3. Evaluate

```python
TOOL_USE_LIVE_EVALUATORS = [
    "tool_schema_valid",
    "tool_args_correct",
    "tool_args_grounded",
    "tool_order_policy",
    "action_despite_abstention",
    "answer_correctness",
    "evidence_grounding",
    "stage_attribution",
]
ev.evaluate(tr.id, evaluators=TOOL_USE_LIVE_EVALUATORS, wait=True)
```

## 4. Offline suite (optional)

```bash
python -m evalverse.run \
  --cases data/cases_cord.json \
  --agents muse-spark-1.3 \
  --conditions clean,blur \
  --n 3
python -m evalverse.export --out studio/public/data
```

Open Studio Overview on the `cord` suite.
