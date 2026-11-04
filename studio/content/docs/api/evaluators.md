---
title: Evaluators
description: Evaluators endpoints from the EvalVerse OpenAPI document.
order: 118
group: API reference
generated: true
---

# Evaluators

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `GET` /api/v1/evaluators

List Evaluators

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/evaluators' \
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

:::endpoint `POST` /api/v1/evaluators

Create Evaluator

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string | yes |  |
| `name` | string | yes |  |
| `id` | string | null |  |  |
| `version` | string | null |  |  |
| `dimension` | string | null |  |  |
| `description` | string | null |  |  |
| `category` | string | null |  |  |
| `modalities` | array[string] | null |  |  |
| `prompt` | string | null |  |  |
| `attach_media` | boolean | null |  |  |
| `judge_model` | string | null |  |  |
| `scale` | string | null |  |  |
| `labels` | array[string] | null |  |  |
| `pass_threshold` | number | null |  |  |
| `checks` | array[object] | null |  |  |
| `rules` | array[object] | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/evaluators' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "string",
    "name": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `PUT` /api/v1/evaluators/{evaluator_id}

Put Evaluator

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `evaluator_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string | yes |  |
| `name` | string | yes |  |
| `id` | string | null |  |  |
| `version` | string | null |  |  |
| `dimension` | string | null |  |  |
| `description` | string | null |  |  |
| `category` | string | null |  |  |
| `modalities` | array[string] | null |  |  |
| `prompt` | string | null |  |  |
| `attach_media` | boolean | null |  |  |
| `judge_model` | string | null |  |  |
| `scale` | string | null |  |  |
| `labels` | array[string] | null |  |  |
| `pass_threshold` | number | null |  |  |
| `checks` | array[object] | null |  |  |
| `rules` | array[object] | null |  |  |


:::examples

### Request

```bash
curl -s -X PUT 'http://127.0.0.1:8000/api/v1/evaluators/{evaluator_id}' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "string",
    "name": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/evaluators/{evaluator_id}

Get Evaluator

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `evaluator_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/evaluators/{evaluator_id}' \
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

:::endpoint `POST` /api/v1/evaluators/{evaluator_id}/test

Test Evaluator

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `evaluator_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `trace_id` | string | yes |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/evaluators/{evaluator_id}/test' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "trace_id": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

