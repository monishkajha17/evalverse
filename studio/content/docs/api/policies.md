---
title: Policies
description: Policies endpoints from the EvalVerse OpenAPI document.
order: 125
group: API reference
generated: true
---

# Policies

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/policies

Create Policy

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `id` | string | null |  |  |
| `filter` | object | null |  |  |
| `sample_rate` | number |  |  |
| `evaluator_ids` | array[string] |  |  |
| `enabled` | boolean |  |  |
| `alert` | object | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/policies' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "string",
    "sample_rate": 0,
    "evaluator_ids": [],
    "enabled": true
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/policies

List Policies

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/policies' \
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

:::endpoint `PUT` /api/v1/policies/{policy_id}

Update Policy

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `policy_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | null |  |  |
| `filter` | object | null |  |  |
| `sample_rate` | number | null |  |  |
| `evaluator_ids` | array[string] | null |  |  |
| `enabled` | boolean | null |  |  |
| `alert` | object | null |  |  |


:::examples

### Request

```bash
curl -s -X PUT 'http://127.0.0.1:8000/api/v1/policies/{policy_id}' \
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

