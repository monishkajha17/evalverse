---
title: "Policy file and environment"
order: 72
group: Reference
---

# Policy file and environment variables

## Offline policy file

Path: **`evalverse/policy.json`** (loaded by `evalverse/scoring.py` as `POLICY_PATH`). There is no separate `evalverse.policy.json` filename in this repo.

Contents:

- `gate.min_ums` / `gate.floors` — release gate
- `dimensions` — which evaluators feed each UMS dimension
- `profiles.*` — weight vectors (renormalised per profile)

Online policies are **API objects** (`/api/v1/policies`), not this file.

## Environment variables

| Variable | Default | Role |
| --- | --- | --- |
| `EVALVERSE_API_KEY` | `dev` | Dev/admin bearer key for server and SDK |
| `EVALVERSE_ALLOW_DEV_KEY` | `true` | When false, reject the configured dev key |
| `EVALVERSE_API_URL` | `http://127.0.0.1:8000` | Importer / clients |
| `EVALVERSE_DB` | `out/evalverse.db` | SQLite path |
| `EVALVERSE_MEDIA_DIR` | `out/media` | Media blob directory |
| `EVALVERSE_HOST` | `127.0.0.1` | Bind host |
| `EVALVERSE_PORT` | `8000` | Bind port |
| `EVALVERSE_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `EVALVERSE_WORKERS` | `4` | Eval worker threads |
| `EVALVERSE_JOB_TIMEOUT` | `60` | Per-job timeout (seconds) |
| `EVALVERSE_SDK_SYNC` | unset | If `1`/`true`, SDK sends synchronously |
| `EVALVERSE_REASONING_EFFORT` | unset | Optional model reasoning effort passthrough |

Studio: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_KEY`, `NEXT_PUBLIC_MODE`, `NEXT_PUBLIC_TOUR_URL`.
