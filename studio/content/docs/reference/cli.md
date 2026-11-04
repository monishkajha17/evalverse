---
title: "CLI commands"
description: "Command-line entry points for the EvalVerse server, offline runner, and dataset builders."
order: 73
group: Reference
---

# CLI commands

## API server

```bash
python -m evalverse.server
```

Serves OpenAPI at `http://127.0.0.1:8000/openapi.json` and the REST surface under `/api/v1/…`.

## Offline runner

```bash
python -m evalverse.run \
  --cases data/cases_cord.json \
  --agents muse-spark-1.3 \
  --judge muse-wonder-1.0 \
  --judge-controls \
  --tag cord
```

Writes suite outputs under `out/` (and export helpers can refresh Studio `/data`). See [Offline experiments](/docs/guides/offline-cli/).

## Dataset helpers

```bash
python -m evalverse.datasets.cord --families menu_list,unanswerable --n 20
```

Other dataset modules live under `evalverse/datasets/`. Pass `--help` on each module for flags.

## Export / Studio data

```bash
python -m evalverse.export
```

(Use the project’s export entrypoint if your checkout wires a different module path — confirm with `python -m evalverse.export --help`.)

## SDK one-liners

There is no separate `evalverse` console script required for tracing; import `EvalVerse` from Python. For HTTP-only smoke tests, use the curl examples in [Quickstart](/docs/quickstart/).
