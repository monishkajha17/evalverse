---
title: Health
description: Health endpoints from the EvalVerse OpenAPI document.
order: 120
group: API reference
generated: true
---

# Health

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `GET` /api/v1/health

Health

### Parameters

_None._

:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/health' \
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

