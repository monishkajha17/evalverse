---
title: "FAQ and troubleshooting"
description: "Fixes for server not found, 401, 429, empty traces, and Studio Live mode."
order: 74
group: Reference
---

# FAQ and troubleshooting

## Server not found / connection refused

**Symptom:** `httpx.ConnectError` or Studio says the API is unreachable.

**Fix:**

1. From the repo root: `python -m evalverse.server` (default `http://127.0.0.1:8000`).
2. Check `curl -s http://127.0.0.1:8000/api/v1/health -H 'Authorization: Bearer dev'`.
3. Set `EVALVERSE_CORS_ORIGINS=http://localhost:3000` if the browser blocks Live calls.

## 401 Unauthorized

**Symptom:** API returns `{"detail":"…"}` with status 401.

**Fix:**

1. Send `Authorization: Bearer <key>` (include the word `Bearer`).
2. Send `X-Project` matching the key’s project.
3. Re-run register if the key was lost — plaintext is shown once.

See [Authentication](/docs/api/authentication/) and [Errors](/docs/api/errors/).

## 429 Too Many Requests

Slow down or use the SDK batcher. See [Rate limits](/docs/api/rate-limits/).

## Empty trace / no spans in Studio

1. Call `ev.flush()` (or exit the process so atexit flush runs).
2. Confirm you open the same project the SDK set in `X-Project`.
3. In Studio Settings, connect Live with that key; Snapshot mode only shows `/data/*.json` suites.

## Evaluator always skipped

Many tool and modality evaluators return `status: completed` with `verdict: not_applicable` / `label: skipped` when the span graph has no tool calls or the wrong modality. That is intentional — missing is not scored as zero. See [Evaluators](/docs/concepts/evaluators/).

## Where is the playground?

`POST /api/v1/playground/runs` exists in Release 0.1. Guide: [Try an input in the playground](/docs/guides/playground/).
