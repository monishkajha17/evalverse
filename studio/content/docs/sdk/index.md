---
title: "SDK"
description: "Python client for traces, spans, media, tools, evaluators, and promotion."
order: 30
group: SDK
---

# SDK

The EvalVerse Python SDK (`evalverse.sdk.EvalVerse`) is the supported way to instrument an agent. It sends traces asynchronously (batched background thread) unless you set `sync=True`.

## Contents

- [Python reference](/docs/sdk/python/) — install, `trace`, `span`, `media`, `tool_call`, `event`, `observe`, `evaluate`, `create_evaluator`, `promote`, with expected output.
- [Configuration](/docs/sdk/configuration/) — constructor args and environment variables.

## Minimal example

```python
from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="http://127.0.0.1:8000", api_key="dev", project="default")

with ev.trace(name="hello", agent="demo") as tr:
    with tr.span("step", type="model") as sp:
        sp.set_output(answer="ok")
    tr.set_output(answer="ok")

ev.flush()
print(tr.id)
```

Expected: a printed trace id; `GET /api/v1/traces/{id}` returns `status: completed` after flush.

Also see [OpenTelemetry ingestion](/docs/guides/opentelemetry/) if you already emit OTLP.
