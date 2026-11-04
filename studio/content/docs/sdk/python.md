---
title: "Python reference"
description: "Install, init, trace, span, media, tool_call, event, observe, evaluate, create_evaluator, and promote."
order: 32
group: SDK
---

# Python reference

Client: `evalverse.sdk.EvalVerse`. Default URL `http://127.0.0.1:8000`, key from `EVALVERSE_API_KEY` or `"dev"`. Headers on every call: `Authorization: Bearer …`, `X-Project: …`. See [Configuration](/docs/sdk/configuration/) and the [glossary](/docs/concepts/glossary/).

## Install and init

```python
from evalverse.sdk import EvalVerse

ev = EvalVerse(
    api_url="http://127.0.0.1:8000",
    api_key="dev",
    project="default",
    sync=True,  # optional: send on the calling thread
)
```

Expected: no exception; `ev._headers()` returns both auth headers.

## Traces and spans

```python
with ev.trace(name="demo", session_id="s1", agent="agent-x", input={"q": 1}) as tr:
    tid = tr.id
    with tr.span("model", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="12.00")
        sp.set_usage(input_tokens=3, output_tokens=2)
    tr.set_output(total="12.00")
ev.flush()
got = ev.get_trace(tid)
print(got["status"], len(got["spans"]))
```

Expected output shape: `status == "completed"`, at least one model span (`tests/test_sdk.py::test_sdk_trace_spans_and_tools`).

## Media

```python
from pathlib import Path
img = Path("data/images_cord/cord_total_01.jpg")
with ev.trace(name="with-media") as tr:
    tr.media(img, role="input", modality="image")
    tr.set_output(answer="148,127")
ev.flush()
print(len(ev.get_trace(tr.id)["media"]))
```

Expected: `media` length ≥ 1 after flush.

## Tool calls

```python
with ev.trace(name="tools") as tr:
    with tr.span("model", type="model") as sp:
        sp.set_output(answer="12.00")
        sp.tool_call("log_expense", {"total": "12.00"}, result={"ok": True})
        sp.tool_call("check_duplicate", {"total": "12.00"}, result={"duplicate": False})
    tr.set_output(total="12.00")
ev.flush()
print(ev.get_trace(tr.id)["tool_call_count"])
```

Expected: `tool_call_count == 2`.

## Events

```python
with ev.trace(name="events") as tr:
    with tr.span("model", type="model") as sp:
        sp.set_output(answer="ok")
        sp.event("turn", start_ms=0, end_ms=1200, speaker="user", payload={"text": "hi"})
    tr.set_output(answer="ok")
ev.flush()
```

`SpanHandle.event` records a temporal event (start/end in ms) and queues `POST /api/v1/traces/{id}/events`.

## Observe decorator

```python
@ev.observe(type="tool", name="add")
def add(a, b):
    return a + b

assert add(2, 3) == 5
ev.flush()
```

Creates a trace (or ambient span) capturing args and return value (`test_sdk_observe_decorator`).

## Evaluate

```python
ev.create_evaluator({
    "type": "rule",
    "name": "has_output",
    "checks": [{"op": "field_present", "path": "output"}],
})
with ev.trace(name="eval-demo") as tr:
    tr.set_output(total="1")
    tid = tr.id
ev.flush()
detail = ev.evaluate(tid, evaluators=["has_output"], wait=True, timeout=10)
print(detail["status"])
print(ev.results(tid))
```

Expected: evaluation reaches `completed` / `partial` / `failed`; `results` is a list.

## Create an evaluator

```python
ev.create_evaluator({
    "type": "rubric",
    "name": "receipt_total_rubric",
    "judge_model": "muse-wonder-1.0",
    "prompt": "Score grounding given {{input}} {{output}} {{tool_calls}}",
    "pass_threshold": 0.8,
})
```

## Promote a trace to a dataset

```python
# dataset_id from POST /api/v1/datasets
item = ev.promote(
    tid,
    dataset="ds_…",
    expectation={"answer": "12.00", "truth_box": [100, 100, 200, 200]},
    tags=["promoted"],
)
print(item and item.get("id"))
```

Maps to `POST /api/v1/traces/{id}/promote`.
