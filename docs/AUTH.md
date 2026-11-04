# Auth (local / self-hosted)

EvalVerse accounts and API keys are **local, self-hosted auth** for a single deployment — not a hosted multi-tenant cloud service.

## What you get

- Email/password users stored in the server SQLite database
- Session tokens (Bearer) for Studio-style account operations
- Project-scoped `evk_…` API keys for SDK / ingest
- Optional local **dev key** (`EVALVERSE_API_KEY`, default `dev`) when `EVALVERSE_ALLOW_DEV_KEY` is true (default locally)

## Security notes

- Passwords use `hashlib.scrypt`; session tokens and API keys are 32-byte random values stored as SHA-256 hashes
- Comparisons use `hmac.compare_digest`; passwords, tokens, and keys are never logged
- API keys are shown **once** at creation; `/auth/me` and `GET /api-keys` return prefix + last 4 only
- Revoked keys and expired sessions are rejected with 401
- An API key bound to project A cannot be used with `X-Project: B` (403)
- Session tokens may only access projects in `project_members`

## Environment

| Variable | Meaning |
|----------|---------|
| `EVALVERSE_API_KEY` | Dev/admin bearer key (default `dev`) |
| `EVALVERSE_ALLOW_DEV_KEY` | Allow the dev key (`true` by default) |
| `EVALVERSE_CORS_ORIGINS` | CORS allow-list (unchanged) |

Disable the dev key in any shared or production-like deploy: `EVALVERSE_ALLOW_DEV_KEY=false`.
