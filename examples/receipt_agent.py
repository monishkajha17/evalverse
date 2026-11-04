#!/usr/bin/env python3
"""Minimal multimodal agent instrumented with the EvalVerse SDK.

Takes one CORD receipt image, asks Muse Spark for the total, then calls two
local tools. Use --mock to run offline.

    python examples/receipt_agent.py --mock
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evalverse import core  # noqa: E402
from evalverse.sdk import EvalVerse  # noqa: E402

CASES = ROOT / "data" / "cases_cord.json"


def log_expense(total: str, currency: str = "IDR") -> dict:
    return {"ok": True, "logged": {"total": total, "currency": currency}}


def check_duplicate(total: str) -> dict:
    known = {"148,127", "43,000", "51.70"}
    return {"duplicate": total in known, "total": total}


def _pick_case() -> dict:
    cases = json.loads(CASES.read_text())
    for c in cases:
        if c.get("id", "").startswith("cord_total_"):
            return c
    return cases[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--api-url", default="http://127.0.0.1:8000")
    ap.add_argument("--project", default="default")
    args = ap.parse_args()

    case = _pick_case()
    image_path = ROOT / case["image"]
    if not image_path.is_file():
        raise SystemExit(f"missing image: {image_path}")

    backend = core.MockBackend(seed=1) if args.mock else core.LiveBackend()
    image_bytes = image_path.read_bytes()

    ev = EvalVerse(api_url=args.api_url, project=args.project)
    model = "muse-spark-1.3"
    answer = ""

    with ev.trace(
        name="receipt_agent",
        session_id=f"demo:{case['id']}",
        agent="receipt-agent",
        input={"case_id": case["id"], "question": case["question"]},
        tags=["example", "cord"],
    ) as tr:
        tr.media(image_path, role="input", modality="image")

        with tr.span(
            "extract_total",
            type="model",
            model=model,
            input={"question": case["question"]},
        ) as sp:
            raw, latency_s, usage = backend.agent(model, case, image_bytes, "clean")
            try:
                parsed = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                parsed = {"answer": raw, "box": None, "evidence": ""}
            answer = str((parsed or {}).get("answer") or "")
            sp.set_output(answer=answer, raw=raw, box=(parsed or {}).get("box"))
            if isinstance(usage, dict):
                sp.set_usage(
                    input_tokens=usage.get("input_tokens"),
                    output_tokens=usage.get("output_tokens"),
                )
            sp.latency_ms = float(latency_s) * 1000.0

            sp.tool_call(
                "log_expense",
                {"total": answer, "currency": "IDR"},
                result=log_expense(answer, "IDR"),
            )
            sp.tool_call(
                "check_duplicate",
                {"total": answer},
                result=check_duplicate(answer),
            )

        tr.set_output(total=answer, case_id=case["id"])

    ev.flush(timeout=15)
    url = f"{args.api_url.rstrip('/')}/api/v1/traces/{tr.id}"
    print(f"trace_id={tr.id}")
    print(f"trace_url={url}")
    print(f"total={answer}")
    ev.close()


if __name__ == "__main__":
    main()
