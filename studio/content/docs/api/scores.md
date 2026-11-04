---
title: Scores
description: Scores endpoints from the EvalVerse OpenAPI document.
order: 130
group: API reference
generated: true
---

# Scores

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `GET` /api/v1/scores

Get Scores

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `run_id` | query | string | null |  |  |
| `experiment_id` | query | string | null |  |  |
| `suite` | query | string | null |  |  |
| `profile` | query | string |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/scores' \
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

