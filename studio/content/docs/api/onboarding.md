---
title: Onboarding
description: Onboarding endpoints from the EvalVerse OpenAPI document.
order: 122
group: API reference
generated: true
---

# Onboarding

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/onboarding/sample-trace

Onboarding Sample Trace

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/onboarding/sample-trace' \
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

