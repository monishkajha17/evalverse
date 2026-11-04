---
title: Reviews
description: Reviews endpoints from the EvalVerse OpenAPI document.
order: 129
group: API reference
generated: true
---

# Reviews

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/reviews

Create Review

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `result_id` | string | yes |  |
| `verdict` | string | yes |  |
| `label` | string | null |  |  |
| `notes` | string | null |  |  |
| `reviewer` | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/reviews' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "result_id": "string",
    "verdict": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/reviews/queue

Reviews Queue

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/reviews/queue' \
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

