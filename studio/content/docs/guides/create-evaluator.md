---
title: "Create an evaluator"
order: 51
group: Guides
---

# Create an evaluator (rubric and rule)

## Rule evaluator

Deterministic checks over the rule context (`build_rule_context` in `engine.py` exposes `output`, `answer`, `tool_calls`, …).

```tabs python|curl
<<<python
ev.create_evaluator({
    "type": "rule",
    "name": "has_output",
    "checks": [{"op": "field_present", "path": "output"}],
})
>>>
<<<curl
curl -s -X POST http://127.0.0.1:8000/api/v1/evaluators \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "rule",
    "name": "has_output",
    "checks": [{"op": "field_present", "path": "output"}]
  }'
>>>
```

## Rubric evaluator

Requires `prompt`. Optional `judge_model`, `pass_threshold`, `attach_media`.

```python
ev.create_evaluator({
    "type": "rubric",
    "name": "receipt_total_rubric",
    "dimension": "Groundedness",
    "judge_model": "muse-wonder-1.0",
    "prompt": "Score whether the total is grounded in the receipt given {{input}} {{output}} {{tool_calls}}",
    "pass_threshold": 0.8,
    "attach_media": True,
})
```

## Test on a trace

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/evaluators/has_output/test \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default" \
  -H "Content-Type: application/json" \
  -d '{"trace_id": "YOUR_TRACE_ID"}'
```

Or Studio → Evaluators → test run.
