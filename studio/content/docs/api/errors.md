---
title: "Errors"
description: "HTTP status codes and error body shape returned by the EvalVerse API."
order: 42
group: API reference
generated: false
---

# Errors

Failed requests return JSON. Typical shape:

```json
{
  "detail": "Invalid API key"
}
```

FastAPI may also return `detail` as a list of validation objects for 422 responses.

## Status codes

| Code | When |
| --- | --- |
| `400` | Bad input the schema accepted but the handler rejects |
| `401` | Missing or invalid Bearer token |
| `403` | Authenticated, but not allowed for this project or action |
| `404` | Unknown trace, evaluator, policy, or other id |
| `409` | Conflict (for example duplicate email on register) |
| `422` | Request body or query failed schema validation |
| `429` | Rate limit exceeded — see [Rate limits](/docs/api/rate-limits/) |
| `500` | Unexpected server error; check server logs |

## Debugging 401

1. Confirm `Authorization: Bearer …` is present (not `Token`, not a bare key).
2. Confirm `X-Project` matches the project bound to the API key.
3. Re-register or create a new key if you lost the secret.

See [FAQ](/docs/reference/faq/) for Studio-specific connection issues.
