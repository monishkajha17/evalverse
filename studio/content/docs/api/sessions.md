---
title: Sessions
description: Sessions endpoints from the EvalVerse OpenAPI document.
order: 131
group: API reference
generated: true
---

# Sessions

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `GET` /api/v1/sessions

List Sessions

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/sessions' \
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

:::endpoint `GET` /api/v1/sessions/{session_id}

Get Session

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `session_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/sessions/{session_id}' \
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

