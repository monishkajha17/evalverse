"""Rebuild evaluator results and traces from a stored results JSON — no model calls.

    python -m evalverse.rescore
    python -m evalverse.rescore --tag cord --margin 25
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import evaluators as ev

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def main():
    ap = argparse.ArgumentParser(description="Rescore stored runs without calling a model.")
    ap.add_argument("--tag", default="", help="suite tag; loads out/results_<tag>.json")
    ap.add_argument(
        "--margin",
        type=float,
        default=ev.DEFAULT_EVIDENCE_MARGIN,
        help="vertical expansion of the true region for evidence_grounding (0-1000 grid; default 25)",
    )
    args = ap.parse_args()

    name = f"results_{args.tag}.json" if args.tag else "results.json"
    path = OUT / name
    if not path.exists():
        raise SystemExit(f"missing {path}")

    data = json.loads(path.read_text())
    if "runs" not in data or "cases" not in data:
        raise SystemExit(f"{path} has no runs/cases to rescore")

    ev.enrich_results_payload(data, evidence_margin=args.margin)
    ev.write_traces(data["traces"])
    path.write_text(json.dumps(data, indent=1))
    print(
        f"rescored {path}: {len(data['results'])} results, "
        f"{len(data['traces'])} traces, {len(data['disagreements'])} disagreements "
        f"(evidence_margin={args.margin})"
    )


if __name__ == "__main__":
    main()
