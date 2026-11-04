---
title: "Judges and audit"
order: 17
group: Concepts
---

# Judges and the audit

The **agent** and the **judge** are separate models. Release 0.1 defaults:

- Agent: `muse-spark-1.3` (and `muse-spark-1.1` in some suites)
- Judge: `muse-wonder-1.0`

Builtin judge evaluators include `perception_judge`, `judge_audit`, and `judge_media_dependence` (see registry).

## Planted answers

Offline judge controls plant wrong or adversarial answers and ask whether the judge accepts them. `judge_audit` aggregates false-accept and false-reject style counts into an explanation string consumed by Studio (e.g. `false-accept 0/30`).

## No-media control

`judge_media_dependence` / blind variants remove or withhold the image so you can see whether the judge still “accepts” without perception. Suite metadata may record both prompt hashes (`judge_prompt_sha256`, `judge_prompt_no_media_sha256` in wonder suite exports).

## Running with controls

```bash
python -m evalverse.run \
  --judge muse-wonder-1.0 \
  --judge-controls \
  --agents muse-spark-1.3 \
  --cases data/cases_cord.json \
  --limit 3
```

Inspect Judge in Studio or the `judge_audit` rows in suite JSON under `studio/public/data/`.
