---
title: "Evaluators and results"
order: 14
group: Concepts
---

# Evaluators and the result contract

Evaluators in Release 0.1 are side-effect-free over stored runs (`evalverse/evaluators.py` module docstring). They do not call the agent again. Paired / suite evaluators read sibling results produced by the offline orchestrator.

## Result contract

Every result carries:

| Field | Meaning |
| --- | --- |
| `status` | `completed` \| `skipped` \| `error` (platform jobs may also use queue statuses) |
| `score` | `number \| null` — **null or skip ≠ success**. Do not treat missing as `0` success without reading `status`/`label`. |
| `verdict` | Coarse outcome (`pass` / `fail` / `not_applicable`, …) |
| `label` | Fine stage or outcome label (`grounded_correct`, `mislocated`, `skipped`, …) |
| `explanation` | Human-readable reason |
| `evidence` | Structured citations when applicable |
| `evaluator_id`, `evaluator_version`, `dimension` | Provenance |

Builtin skip examples (`evalverse/server/engine.py`):

- Reference required but no expectation → `skipped`, explanation `no expectation`.
- Tool-use evaluator with no tool spans → `skipped`, reason `no tool calls`.

## Platform evaluators

Custom evaluators (`POST /api/v1/evaluators`) are `type: "rubric" | "rule"` stored in `evaluator_defs`. Rubrics need a `prompt`; rules need `checks` / `rules`.

## Running

```python
ev.evaluate(trace_id, evaluators=["evidence_grounding", "answer_correctness"], wait=True)
```

Or `POST /api/v1/evaluations` with `trace_ids` / `filter` and `evaluator_ids`.

See the [evaluator catalogue](/docs/reference/evaluator-catalogue/) for the builtin list.
