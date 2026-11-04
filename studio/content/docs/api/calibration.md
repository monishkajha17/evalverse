---
title: Calibration
description: Calibration endpoints from the EvalVerse OpenAPI document.
order: 114
group: API reference
generated: true
---

# Calibration

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `GET` /api/v1/calibration

Calibration

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `evaluator_id` | query | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/calibration' \
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

