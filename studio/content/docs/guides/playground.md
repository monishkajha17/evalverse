---
title: "Try an input in the playground"
description: "Use the playground API to upload a file, ask a question, and poll the run."
order: 57
group: Guides
---

# Try an input in the playground

Release 0.1 includes a Try-it playground:

- `POST /api/v1/playground/runs` — multipart form; returns **202** with a run id
- `GET /api/v1/playground/runs/{run_id}` — poll status and answer

Studio also surfaces this at `/try/`.

## Start a run (multipart)

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/playground/runs' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -F 'question=What is the total on this receipt? Answer with the number only.' \
  -F 'agent_model=muse-spark-1.3' \
  -F 'judge_model=muse-wonder-1.0' \
  -F 'files=@data/images_cord/cord_total_01.jpg'
```

Optional repeated fields: `evaluator_ids`, `conditions`, or JSON list fallbacks `evaluator_ids_json` / `conditions_json`. Set `mock=true` for a dry path without calling models.

Expected: HTTP 202 JSON with a run `id` and `status_url`.

## Poll the run

```bash
curl -s 'http://127.0.0.1:8000/api/v1/playground/runs/<run_id>' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default'
```

Expected: status moves `pending` → `running` → `completed` (or `failed`), with answer / trace ids when done. A worker process must be running (started with the server) to execute queued runs.

## When to use traces instead

For agents with tools, parallel spans, or online policies, instrument with the [SDK](/docs/sdk/) so you get a full **trace**. The playground is for a quick question plus optional media.
