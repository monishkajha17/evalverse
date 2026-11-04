---
title: "Authentication"
description: "How EvalVerse authenticates API calls with Bearer tokens and X-Project."
order: 41
group: API reference
generated: false
---

# Authentication

Every authenticated request needs two headers:

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <token>` | An API key (`evk_…`) or a session token from login/register |
| `X-Project: <project-id>` | The project the key belongs to (API keys are single-project) |

The default local key is `dev` with project `default` when you have not registered yet. Prefer a real key from register for anything beyond a smoke test.

## Register and get a key

```tabs python|curl
<<<python
import httpx

r = httpx.post(
    "http://127.0.0.1:8000/api/v1/auth/register",
    json={"email": "docs@example.com", "password": "password1", "name": "Docs"},
)
print(r.status_code, r.json().keys())
>>>
<<<curl
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"docs@example.com","password":"password1","name":"Docs"}'
>>>
```

The response includes `api_key` once. Store it; you cannot fetch the plaintext again.

## Login

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"docs@example.com","password":"password1"}'
```

Use the returned session token as the Bearer value. Session tokens are for Studio/browser flows; agents should use API keys.

## API keys

List and create keys under `/api/v1/api-keys` while authenticated. See [Api Keys](/docs/api/api-keys/).

> [!NOTE]
> Health (`GET /api/v1/health`) still expects a Bearer token in Release 0.1 when the server is configured with auth middleware. Use `Authorization: Bearer dev` for the local default.

## Next

- [Errors](/docs/api/errors/)
- [Rate limits](/docs/api/rate-limits/)
- [Quickstart](/docs/quickstart/)
