"""Run a EvalVerse evaluation.

    python -m evalverse.run --agents muse-spark-1.1,muse-spark-1.3 --judge muse-spark-1.3
    python -m evalverse.run --mock                      # offline smoke test, no API key
    python -m evalverse.run --limit 3 --conditions clean  # cheap first real call
    python -m evalverse.run --mock --limit 3 --judge-controls

Writes out/results.json. Then: python -m evalverse.report
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import core
from .orchestrator import Orchestrator

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def load_cases(limit=None, path="data/cases.json"):
    cases = json.loads((ROOT / path).read_text())
    return cases[:limit] if limit else cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", default="muse-spark-1.1,muse-spark-1.3")
    ap.add_argument("--judge", default="muse-spark-1.3")
    ap.add_argument("--conditions", default="clean,blur,noise,lowres")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--cases", default="data/cases.json", help="dataset file, e.g. data/cases_cord.json")
    ap.add_argument("--tag", default="", help="name for this suite; writes out/results_<tag>.json")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument(
        "--judge-controls",
        action="store_true",
        help="also judge planted answers without the image (judge media dependence)",
    )
    args = ap.parse_args()

    backend = core.MockBackend() if args.mock else core.LiveBackend()
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    cases = load_cases(args.limit, args.cases)

    orch = Orchestrator(
        cases=cases,
        agents=agents,
        variants=conditions,
        backend=backend,
        judge_model=args.judge,
        config={
            "mock": args.mock,
            "judge_controls": args.judge_controls,
            "dataset_path": args.cases,
        },
    )
    result = orch.execute(workers=args.workers)
    OUT.mkdir(exist_ok=True)
    name = f"results_{args.tag}.json" if args.tag else "results.json"
    (OUT / name).write_text(json.dumps(result, indent=1))
    print(f"wrote {OUT / name} in {result['meta']['seconds']}s")


if __name__ == "__main__":
    main()
