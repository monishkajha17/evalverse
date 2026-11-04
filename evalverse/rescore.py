"""Rebuild evaluator results and traces from a stored results JSON — no model calls.

    python -m evalverse.rescore
    python -m evalverse.rescore --tag cord --margin 25
    python -m evalverse.rescore --tag audio
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import evaluators as ev
from . import scoring

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def _backfill_audio_asr_details(data: dict) -> None:
    """Copy per-turn ASR latency/wer from legacy or fan-out spans onto runs when missing."""
    if (data.get("meta") or {}).get("modality") != "audio" and not any(
        (c or {}).get("modality") == "audio" for c in (data.get("cases") or [])
    ):
        return
    from evalverse.audio_run import _asr_details_from_trace

    by_key: dict[tuple, list] = {}
    for tr in data.get("traces") or []:
        recovered = _asr_details_from_trace(tr)
        if recovered:
            by_key[(tr.get("case_id"), tr.get("variant"))] = recovered
    for run in data.get("runs") or []:
        if run.get("asr_details"):
            continue
        key = (run.get("case_id"), run.get("condition") or run.get("variant"))
        if key in by_key:
            run["asr_details"] = by_key[key]


def main():
    ap = argparse.ArgumentParser(description="Rescore stored runs without calling a model.")
    ap.add_argument("--tag", default="", help="suite tag; loads out/results_<tag>.json")
    ap.add_argument(
        "--margin",
        type=float,
        default=ev.DEFAULT_EVIDENCE_MARGIN,
        help="vertical expansion of the true region for evidence_grounding (0-1000 grid; default 25)",
    )
    ap.add_argument(
        "--profile",
        default="balanced",
        help="UMS profile written into scores (default balanced)",
    )
    args = ap.parse_args()

    name = f"results_{args.tag}.json" if args.tag else "results.json"
    path = OUT / name
    if not path.exists():
        raise SystemExit(f"missing {path}")

    data = json.loads(path.read_text())
    if "runs" not in data or "cases" not in data:
        raise SystemExit(f"{path} has no runs/cases to rescore")

    _backfill_audio_asr_details(data)
    ev.enrich_results_payload(data, evidence_margin=args.margin)
    data["scores"] = scoring.score_payload(data, profile=args.profile)
    ev.write_traces(data["traces"])

    def _jsonable(obj):
        if hasattr(obj, "item"):
            try:
                return obj.item()
            except Exception:
                pass
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    path.write_text(json.dumps(data, indent=1, default=_jsonable))
    print(
        f"rescored {path}: {len(data['results'])} results, "
        f"{len(data['traces'])} traces, {len(data['disagreements'])} disagreements "
        f"(evidence_margin={args.margin}, ums_profile={args.profile})"
    )


if __name__ == "__main__":
    main()
