---
title: "Rate limits"
description: "How EvalVerse throttles authenticated API traffic in Release 0.1."
order: 43
group: API reference
generated: false
---

# Rate limits

Release 0.1 applies a simple per-key request budget on the API process. When you exceed it, the server responds with **429** and a short retry hint in `detail`.

> [!TIP]
> For local demos, the default budget is generous. If you loop create-trace in a tight script and see 429, add a small sleep or batch through the SDK sender queue instead of raw HTTP.

## What to do on 429

1. Back off (start at ~250 ms, then double).
2. Prefer the Python SDK: it batches span/media uploads on a background thread.
3. Do not mint a new API key to bypass limits — keys share the same project budget intent.

There is no separate public “quota” endpoint in Release 0.1. Treat 429 as a soft signal to slow down.
