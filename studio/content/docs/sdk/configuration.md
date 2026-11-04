---
title: "Configuration"
description: "Constructor arguments and environment variables for the EvalVerse Python SDK and server."
order: 31
group: SDK
---

# Configuration

## SDK constructor

```python
EvalVerse(
    api_url="http://127.0.0.1:8000",  # or EVALVERSE_API_URL
    api_key="dev",                    # or EVALVERSE_API_KEY
    project="default",                # X-Project header
    sync=False,                       # True = send on the calling thread
)
```

| Argument | Env fallback | Meaning |
| --- | --- | --- |
| `api_url` | `EVALVERSE_API_URL` | Base URL of the API |
| `api_key` | `EVALVERSE_API_KEY` | Bearer token |
| `project` | — | Sent as `X-Project` |
| `sync` | — | Disable the background sender |

## Server environment

| Variable | Meaning |
| --- | --- |
| `EVALVERSE_API_KEY` | Default bootstrap key / server expectation in local mode |
| `EVALVERSE_CORS_ORIGINS` | Comma-separated browser origins (include `http://localhost:3000`) |
| `EVALVERSE_DB` | Optional SQLite path override |
| `EVALVERSE_HOST` / `EVALVERSE_PORT` | Bind address when supported by your launch script |

Offline scoring weights and gates live in `evalverse/policy.json` — see [Policy file and environment](/docs/reference/policy-and-env/).

## Studio environment

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API base for Live mode |
| `NEXT_PUBLIC_API_KEY` | Default key shown in Settings |
| `NEXT_PUBLIC_MODE` | `live` or `snapshot` |

> [!WARNING]
> Do not commit real API keys. Register a key per machine or CI secret store.
