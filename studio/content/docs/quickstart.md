---
title: "Quickstart"
description: "Create an account, get a key, start the server, send a first trace, open it in Studio, run an evaluator, and turn on an online policy."
order: 2
group: Start
---

# Quickstart

End-to-end path: install → server → account → first trace → Studio → evaluator → online policy. Each step lists the output you should see.

## 1. Install

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Studio (optional, separate Node toolchain):

```bash
cd studio
npm install
```

## 2. Start the server

```bash
export EVALVERSE_API_KEY=dev
export EVALVERSE_CORS_ORIGINS=http://localhost:3000
python -m evalverse.server
```

Health check:

```bash
curl -s http://127.0.0.1:8000/api/v1/health \
  -H 'Authorization: Bearer dev'
```

Expected: `{"status":"ok"}`.

## 3. Create an account

```tabs python|curl
<<<python
import httpx

r = httpx.post(
    "http://127.0.0.1:8000/api/v1/auth/register",
    json={"email": "you@example.com", "password": "password1", "name": "You"},
)
r.raise_for_status()
body = r.json()
print(body["project"], body["api_key"][:12] + "…")
>>>
<<<curl
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "you@example.com",
    "password": "password1",
    "name": "You"
  }'
>>>
```

Save `api_key` (shown once) and `project`. Or open Studio `/signup/` and follow `/get-started/`.

## 4. Send a first trace (SDK)

```python
from evalverse.sdk import EvalVerse

ev = EvalVerse(
    api_url="http://127.0.0.1:8000",
    api_key="evk_…",          # from register
    project="your-project",
)

with ev.trace(name="hello", session_id="qs:1", agent="muse-spark-1.3") as tr:
    with tr.span("extract", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="42")
    tr.set_output(answer="42")

ev.flush()
print(tr.id)
```

## 5. Open it in Studio

```bash
cd studio && npm run dev
```

Open [http://localhost:3000/traces/](http://localhost:3000/traces/). Sign in or paste the API key under Settings → Connect a self-hosted server so the badge shows Live.

## 6. Run an evaluator

Builtin (needs an expectation on the trace for reference-based checks):

```python
run = ev.evaluate(
    tr.id,
    evaluators=["answer_correctness"],
    wait=True,
)
print(run["status"], [(r["evaluator_id"], r["status"], r["label"]) for r in run.get("results") or []])
```

Or create a rule evaluator that only checks output presence (from `tests/test_sdk.py`):

```python
ev.create_evaluator({
    "type": "rule",
    "name": "has_output",
    "checks": [{"op": "field_present", "path": "output"}],
})
detail = ev.evaluate(tr.id, evaluators=["has_output"], wait=True)
print(detail["status"])
```

## 7. Enable an online policy

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/policies \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: your-project" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "live-sample",
    "filter": {"tags": ["live"]},
    "sample_rate": 1.0,
    "evaluator_ids": ["answer_correctness", "evidence_grounding"],
    "enabled": true
  }'
```

Tag subsequent traces with `"tags": ["live"]` so the policy matches. Inspect Policies in Studio.

## Next

- [SDK](/docs/sdk/)
- [Online evaluation and policies](/docs/guides/online-evaluation/)
- [API: traces](/docs/api/traces/)
- [Glossary](/docs/concepts/glossary/)
