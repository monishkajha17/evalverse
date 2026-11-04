---
title: Evaluations
description: Evaluations endpoints from the EvalVerse OpenAPI document.
order: 117
group: API reference
generated: true
---

# Evaluations

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/evaluations

Create Evaluation

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `trace_ids` | array[string] | null |  |  |
| `filter` | object | null |  |  |
| `evaluator_ids` | array[string] | yes |  |
| `dataset_item_id` | string | null |  |  |
| `dataset_version_id` | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/evaluations' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "evaluator_ids": []
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/evaluations/{run_id}

Get Evaluation

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `run_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/evaluations/{run_id}' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default'
```

### Response

```json
{
  "status": "ok"
}
```

:::

