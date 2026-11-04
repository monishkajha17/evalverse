---
title: "Tool-call verification"
order: 54
group: Guides
---

# Tool-call verification

Builtin tool-use evaluators (registry category `tool_use`):

| id | Checks |
| --- | --- |
| `tool_schema_valid` | Tool name / args shape |
| `tool_args_correct` | Args match expectation / answer |
| `tool_args_grounded` | Args grounded in media / answer |
| `tool_order_policy` | Ordering constraints |
| `action_despite_abstention` | Tools fired while the model abstained |

They skip when the trace has no `type="tool"` spans (`engine.py`).

## Emitting tool spans

```python
with tr.span("extract_total", type="model") as sp:
    sp.set_output(answer="42.50", box=[120, 400, 300, 460])
    sp.tool_call("check_duplicate", {"amount": 42.50}, result={"duplicate": False})
    sp.tool_call("log_expense", {"amount": 42.50, "currency": "IDR"}, result={"ok": True})
```

## Live policy

See `examples/receipt_agent.py` → `TOOL_USE_LIVE_EVALUATORS` and `ensure_tool_use_live_policy`.
