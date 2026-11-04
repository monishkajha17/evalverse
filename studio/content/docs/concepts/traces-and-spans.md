---
title: "Traces and spans"
order: 10
group: Concepts
---

# Traces and spans

A **trace** is one recorded execution. A **span** is a timed node inside that trace. Spans form a directed acyclic graph: each span has `parent_ids: string[]` and may have several parents (join of parallel work into one model call).

## Trace fields (API)

Stored by `POST /api/v1/traces` (`evalverse/server/schemas.py` → `TraceCreate`):

| Field | Role |
| --- | --- |
| `id` | Client or server assigned |
| `session_id` | Groups related traces |
| `name`, `agent` | Display / filter |
| `status` | `running` \| `completed` \| `failed` |
| `input`, `output` | JSON payloads |
| `metadata` | Free-form; often holds `expectation`, `variant`, `case_id` |
| `tags` | Used by online policies |
| `source` | `sdk` \| `otlp` \| `import` |
| `spans` | Inline span list on create |
| `media` | Attachments by `media_id` |

## Span fields

| Field | Role |
| --- | --- |
| `id` | Unique within the trace |
| `parent_ids` | Zero or more parents |
| `type` | `agent` \| `model` \| `tool` \| `retrieval` \| `media` \| `evaluation` \| `custom` |
| `name`, `model` | Labels |
| `status` | `pending` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `input`, `output`, `usage`, `attributes`, `error` | Payloads |
| `started_at`, `ended_at`, `latency_ms` | Timing |

The server rejects cycles when spans are written (`tests/test_server.py` → `test_cycle_rejection`).

## SDK shape

```python
with ev.trace(name="demo", session_id="s1", agent="agent-x") as tr:
    with tr.span("model", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="12.00")
        sp.tool_call("log_expense", {"total": "12.00"}, result={"ok": True})
    tr.set_output(total="12.00")
ev.flush()
```

`SpanHandle.tool_call` creates a child span with `type="tool"` and `parent_ids=[self.id]` (`evalverse/sdk.py`).

## Parallel parents

When several spans feed one join, pass multiple parents:

```python
with tr.span("join", type="model", parent_ids=[a.id, b.id]) as sp:
    sp.set_output(answer="…")
```

If `parent_ids` is omitted, the SDK uses the current span stack top (nested `with tr.span`).
