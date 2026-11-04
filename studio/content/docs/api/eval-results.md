---
title: Eval Results
description: Eval Results endpoints from the EvalVerse OpenAPI document.
order: 116
group: API reference
generated: true
---

# Eval Results

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/eval_results

Upsert Eval Result

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `run_id` | string | yes |  |
| `trace_id` | string | null |  |  |
| `evaluator_id` | string | null |  |  |
| `evaluator_version` | string | null |  |  |
| `dimension` | string | null |  |  |
| `status` | string | null |  |  |
| `score` | number | null |  |  |
| `verdict` | string | null |  |  |
| `label` | string | null |  |  |
| `explanation` | string | null |  |  |
| `evidence` | any | null |  |  |
| `meta` | any | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/eval_results' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "string",
    "run_id": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

