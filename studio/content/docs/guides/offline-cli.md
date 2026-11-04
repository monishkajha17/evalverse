---
title: "Offline experiments (CLI)"
order: 56
group: Guides
---

# Run offline experiments from the CLI

## evalverse.run

```bash
python -m evalverse.run \
  --cases data/cases_cord.json \
  --agents muse-spark-1.3 \
  --conditions clean,blur,noise \
  --n 5 \
  --judge muse-wonder-1.0 \
  --judge-controls
```

See `evalverse/run.py` for the full flag set (mock vs real backends, session prefixes, tags).

## Rescore

```bash
python -m evalverse.rescore --tag cord
```

Recomputes evaluator rows from stored runs without re-calling the agent (when supported by the tag).

## Scoring / UMS

```bash
python -m evalverse.scoring --tag cord
```

Applies `evalverse/policy.json` weights, CI, and gate.

## Export to Studio snapshot

```bash
python -m evalverse.export --out studio/public/data
```

Writes suite JSON + `index.json` consumed by Studio Snapshot mode.

## Platform experiments API

For online A/B style runs against dataset versions, use `POST /api/v1/experiments` and `/runs` ([API: experiments](/docs/api/experiments/)).
