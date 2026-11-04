---
title: "Online evaluation and policies"
order: 52
group: Guides
---

# Online evaluation and policies

A **policy** selects live traces and enqueues evaluators.

## Create

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/policies \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tool-use-live",
    "filter": {"tags": ["live"]},
    "sample_rate": 1.0,
    "evaluator_ids": [
      "tool_schema_valid",
      "tool_args_correct",
      "answer_correctness",
      "evidence_grounding"
    ],
    "enabled": true,
    "alert": {"on_fail": true}
  }'
```

## Matching

Filters commonly use `tags`. A trace without the required tag does not enqueue (`tests/test_tool_use.py` covers the live-tag edge case).

`sample_rate` is 0–1. Use `1.0` for canaries.

## Inspect

- `GET /api/v1/policies`
- `GET /api/v1/alerts`
- `GET /api/v1/queue`

Studio → Policies / Review.
