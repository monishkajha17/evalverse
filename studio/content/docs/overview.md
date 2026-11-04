---
title: "Overview"
description: "What EvalVerse is, who it is for, the six questions we ask about a run, and what Release 0.1 covers."
order: 1
group: Start
---

# Overview

EvalVerse is a testing and monitoring platform for AI agents that see, hear, read and act. You send a **trace** (the full record of one agent run), EvalVerse checks the answer against the **evidence** in the file the agent was given, and you get a verdict, dimension scores, and a release **gate**.

## Who it is for

- Product and applied-ML teams shipping multimodal agents (receipts, voice, screen video).
- Engineers who need offline regressions and online sampling on the same evaluator contracts.
- Anyone who must measure a **judge** model instead of trusting it blindly.

If you only need a chat transcript store, this is heavier than you need. If you need “right answer, wrong place” failures called out, you are in the right place.

## The six questions we ask about a run

1. **Perception** — Did it read or hear the input correctly?
2. **Groundedness** — Is the answer backed by a specific place in the input?
3. **Temporal grounding** — Did it point to the right moment in audio or video?
4. **Hallucination** — Did it say things that are not in the input?
5. **Completeness** — Did it leave out things it should have mentioned?
6. **Reasoning** — Given what it saw, did it reach the right conclusion?

We also track media dependence, robustness, honesty, tool use, and judge trust. Details: [Evaluation dimensions](/docs/concepts/evaluation-dimensions/). Terms: [Glossary](/docs/concepts/glossary/).

## What Release 0.1 covers

| Area | Coverage |
| --- | --- |
| Images | Receipt / document agents (CORD v2 and generated charts) |
| Audio | Spoken conversations via transcription (LibriSpeech-based suites) |
| Video | Timestamped frames, not a separate video-native judge path |
| Platform | FastAPI server, Python SDK, OTLP ingest, Studio UI, offline CLI |
| Auth | Local accounts and API keys (self-hosted) |

## What Release 0.1 does not cover

- Hosted multi-tenant cloud as a product.
- Replacing your agent runtime or hosting models as a service.
- Guaranteeing every builtin evaluator applies to every modality without expectations or tool spans (many correctly return skipped).

## Architecture

![EvalVerse system architecture](/docs/01_system_architecture.png)

Agent code (SDK or OTLP) sends traces to the API. The API stores projects, traces, spans, media, datasets, evaluators, jobs, policies, and reviews. Studio reads Live from the API or Snapshot JSON under `/data`.

## Next

- [Quickstart](/docs/quickstart/) — account, key, first trace, evaluator, policy.
- [Core concepts](/docs/concepts/core/) — one-page picture.
- [SDK](/docs/sdk/) — Python client.
- [API reference](/docs/api/) — OpenAPI-generated endpoints.
