---
title: Experiments
description: Experiments endpoints from the EvalVerse OpenAPI document.
order: 119
group: API reference
generated: true
---

# Experiments

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/experiments

Create Experiment

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `dataset_version_id` | string | yes |  |
| `agents` | array[object | object | string] | yes |  |
| `variants` | array[string] |  |  |
| `evaluator_ids` | array[string] |  |  |
| `judge_model` | string | null |  |  |
| `mock` | boolean |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/experiments' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "string",
    "dataset_version_id": "string",
    "agents": [],
    "variants": [],
    "evaluator_ids": [],
    "mock": true
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/experiments

List Experiments

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/experiments' \
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

:::endpoint `GET` /api/v1/experiments/{experiment_id}

Get Experiment

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `experiment_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/experiments/{experiment_id}' \
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

:::endpoint `POST` /api/v1/experiments/{experiment_id}/runs

Run Experiment

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `experiment_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

_No fields._

:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/experiments/{experiment_id}/runs' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/experiments/{experiment_id}/compare

Compare Experiments

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `experiment_id` | path | string | yes |  |
| `a` | query | string | yes |  |
| `b` | query | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/experiments/{experiment_id}/compare' \
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

