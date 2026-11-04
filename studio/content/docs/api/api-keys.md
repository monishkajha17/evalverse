---
title: Api Keys
description: Api Keys endpoints from the EvalVerse OpenAPI document.
order: 112
group: API reference
generated: true
---

# Api Keys

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/api-keys

Create Api Key

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `project` | string | yes |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/api-keys' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "string",
    "project": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/api-keys

List Api Keys

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/api-keys' \
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

:::endpoint `DELETE` /api/v1/api-keys/{key_id}

Revoke Api Key

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `key_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X DELETE 'http://127.0.0.1:8000/api/v1/api-keys/{key_id}' \
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

