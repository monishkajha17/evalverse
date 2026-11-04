---
title: "OpenTelemetry ingestion"
order: 53
group: Guides
---

# OpenTelemetry ingestion (OTLP)

EvalVerse accepts OTLP/HTTP JSON at `POST /v1/traces` (protobuf optional if `opentelemetry-proto` is installed).

## Headers

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <api-key-or-session>` |
| `X-Project` | Project slug (must match API key binding) |
| `Content-Type` | `application/json` (or protobuf types) |

## Exporter sketch

```python
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="http://127.0.0.1:8000/v1/traces",
    headers={
        "authorization": "Bearer dev",
        "x-project": "default",
    },
)
```

Mapping into EvalVerse traces/spans/media is implemented in `evalverse/server/otlp.py`. Prefer the Python SDK when you need first-class media upload and tool spans.
