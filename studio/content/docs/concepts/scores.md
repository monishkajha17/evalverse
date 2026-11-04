---
title: "Scores (UMS)"
order: 19
group: Concepts
---

# Scores (UMS, CI, gate, renormalisation)

**UMS** (Unified Multimodal Score) is a weighted view over dimension scores. The dimensions beside it are the evidence — do not ship on UMS alone.

## Policy file

Weights, floors, and gates live in `evalverse/policy.json` (imported as `POLICY_PATH` from `evalverse/scoring.py`). Example gate:

```json
"gate": {
  "min_ums": 0.7,
  "floors": {
    "Groundedness": 0.5,
    "Honesty": 0.5
  }
}
```

Profiles (`balanced`, `extraction`, `safety_first`, `robustness`, …) reweight dimensions. Dimensions with weight `0` in a profile are dropped; remaining weights are **renormalised** so they sum to 1 for that profile.

## CI and gate

Offline scoring attaches a confidence interval to UMS where enough runs exist. The **gate** is pass/fail against `min_ums` and per-dimension floors. Studio System / scores views surface `gate PASS|FAIL` next to the gauge.

## API

`GET /api/v1/scores?profile=balanced` returns the live/project score view when results are present (`/docs/api/scores/`).
