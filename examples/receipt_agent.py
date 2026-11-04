#!/usr/bin/env python3
"""Instrumented receipt agent with tool-call verification.

Loads CORD receipts (optionally perturbed), asks the model for a total plus
planned tool calls, executes local stub tools, and traces everything via the
EvalVerse SDK.

    python examples/receipt_agent.py --mock --cases data/cases_cord.json --n 3 --conditions clean,blur
    python examples/receipt_agent.py --real --cases data/cases_cord.json --n 30 --conditions clean,blur,noise \\
        --agent muse-spark-1.3 --session-prefix live
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evalverse import core  # noqa: E402
from evalverse.sdk import EvalVerse  # noqa: E402

TOOL_USE_LIVE_EVALUATORS = [
    "tool_schema_valid",
    "tool_args_correct",
    "tool_args_grounded",
    "tool_order_policy",
    "action_despite_abstention",
    "answer_correctness",
    "evidence_grounding",
    "stage_attribution",
]


class ExpenseLedger:
    """In-memory stub tools for duplicate check + expense logging."""

    def __init__(self) -> None:
        self.seen: list[float] = []
        self.logged: list[dict[str, Any]] = []

    def check_duplicate(self, amount: Any) -> dict[str, Any]:
        parsed = core._amount(amount)
        dup = parsed is not None and any(abs(parsed - s) < 0.0051 for s in self.seen)
        return {"duplicate": dup, "amount": amount, "parsed": parsed}

    def log_expense(
        self,
        amount: Any,
        currency: str = "IDR",
        category: str = "meals",
    ) -> dict[str, Any]:
        parsed = core._amount(amount)
        entry = {
            "amount": amount,
            "parsed": parsed,
            "currency": currency,
            "category": category,
        }
        self.logged.append(entry)
        if parsed is not None:
            self.seen.append(parsed)
        return {"ok": True, "logged": entry}


def _parse_model_payload(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return {"answer": str(raw), "box": None, "evidence": "", "tool_calls": []}
    parsed = core.parse_json(raw)
    if parsed is None:
        return {"answer": raw, "box": None, "evidence": "", "tool_calls": []}
    return parsed


def _normalize_tool_calls(payload: dict[str, Any]) -> list[dict[str, Any]]:
    calls = payload.get("tool_calls")
    if calls is None:
        return []
    if isinstance(calls, dict):
        calls = [calls]
    if not isinstance(calls, list):
        return []
    out: list[dict[str, Any]] = []
    for c in calls:
        if not isinstance(c, dict):
            continue
        name = c.get("name") or c.get("tool") or c.get("function")
        args = c.get("arguments") or c.get("args") or c.get("parameters") or {}
        if isinstance(name, dict):
            # occasional {"name": {"name": "..."}}
            name = name.get("name")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        if not isinstance(args, dict):
            args = {}
        if not name:
            continue
        out.append({"name": str(name), "arguments": args})
    return out


def _perturbed_image(case: dict, condition: str, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"{case['id']}_{condition}.png"
    if out.is_file():
        return out
    src = ROOT / case["image"]
    img = Image.open(src)
    core.perturb(img, condition, seed=hash(case["id"]) % 10_000).save(out)
    return out


def ensure_tool_use_live_policy(ev: EvalVerse) -> None:
    policies = ev._request("GET", "/api/v1/policies") or []
    for p in policies:
        if p.get("name") == "tool-use-live":
            return
    ev._request(
        "POST",
        "/api/v1/policies",
        json={
            "name": "tool-use-live",
            "filter": {"tags": ["live"]},
            "sample_rate": 1.0,
            "evaluator_ids": list(TOOL_USE_LIVE_EVALUATORS),
            "enabled": True,
        },
    )


def run_one(
    *,
    ev: EvalVerse,
    backend: Any,
    case: dict,
    condition: str,
    model: str,
    session_prefix: str,
    ledger: ExpenseLedger,
    image_path: Path,
    force_payload: dict[str, Any] | None = None,
) -> str:
    image_bytes = image_path.read_bytes()
    prompt = core.AGENT_TOOL_PROMPT.format(question=case["question"])
    session_id = f"{session_prefix}:{case['id']}"
    expectation = {
        "answer": case.get("answer"),
        "truth_box": case.get("truth_box"),
        "family": case.get("family"),
        "case_id": case["id"],
        "variant": condition,
    }

    with ev.trace(
        name="receipt_agent",
        session_id=session_id,
        agent=model,
        input={"case_id": case["id"], "question": case["question"], "condition": condition},
        metadata={"expectation": expectation, "variant": condition, "case_id": case["id"]},
        tags=["live", condition],
    ) as tr:
        tr.media(image_path, role="input", modality="image")

        with tr.span(
            "extract_total",
            type="model",
            model=model,
            input={"question": case["question"], "prompt": prompt},
        ) as sp:
            if force_payload is not None:
                raw = json.dumps(force_payload)
                latency_s = 0.01
                usage = {"input_tokens": 1, "output_tokens": 1}
            else:
                raw, latency_s, usage = backend.agent(
                    model, case, image_bytes, condition, prompt=prompt
                )
            payload = _parse_model_payload(raw)
            answer = payload.get("answer", "")
            if isinstance(answer, (dict, list)):
                answer = json.dumps(answer, ensure_ascii=False)
            else:
                answer = str(answer) if answer is not None else ""
            box = core.clean_box(payload.get("box"))
            evidence = str(payload.get("evidence") or "")[:300]
            tool_calls = _normalize_tool_calls(payload)

            sp.set_output(answer=answer, raw=raw, box=box, evidence=evidence, tool_calls=tool_calls)
            if isinstance(usage, dict):
                sp.set_usage(
                    input_tokens=usage.get("input_tokens"),
                    output_tokens=usage.get("output_tokens"),
                )
            sp.latency_ms = float(latency_s) * 1000.0

            for call in tool_calls:
                name = call["name"]
                args = call["arguments"]
                if name == "check_duplicate":
                    result = ledger.check_duplicate(args.get("amount"))
                elif name == "log_expense":
                    result = ledger.log_expense(
                        args.get("amount"),
                        currency=str(args.get("currency") or "IDR"),
                        category=str(args.get("category") or "meals"),
                    )
                else:
                    result = {"ok": False, "error": f"unknown tool {name}"}
                sp.tool_call(name, args, result=result)

        tr.set_output(answer=answer, box=box, case_id=case["id"], condition=condition)

    return tr.id


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--real", action="store_true", help="Call LiveBackend (Meta API)")
    ap.add_argument("--mock", action="store_true", help="No API calls (MockBackend)")
    ap.add_argument("--cases", default="data/cases_cord.json")
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--conditions", default="clean")
    ap.add_argument("--agent", default="muse-spark-1.3")
    ap.add_argument("--session-prefix", default="live")
    ap.add_argument("--api-url", default="http://127.0.0.1:8000")
    ap.add_argument("--project", default="default")
    ap.add_argument(
        "--scenario",
        choices=("default", "wrong_amount", "acted_unsure"),
        default="default",
        help="Force a deterministic tool plan (for tests / demos)",
    )
    args = ap.parse_args(argv)

    if args.real and args.mock:
        raise SystemExit("pass only one of --real / --mock")
    if not args.real and not args.mock:
        # Default to mock when neither is set so local demos stay offline-safe.
        args.mock = True

    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = ROOT / cases_path
    cases = json.loads(cases_path.read_text())
    cases = cases[: max(1, args.n)]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    if not conditions:
        conditions = ["clean"]

    backend: Any = core.MockBackend(seed=1) if args.mock else core.LiveBackend()
    ev = EvalVerse(api_url=args.api_url, project=args.project)
    ensure_tool_use_live_policy(ev)

    ledger = ExpenseLedger()
    cache_dir = ROOT / "out" / "perturbed"
    trace_ids: list[str] = []
    total = 0

    with tempfile.TemporaryDirectory(prefix="receipt_agent_") as tmp:
        # Prefer shared cache under out/perturbed; fall back to tmp if unwritable.
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            image_cache = cache_dir
        except OSError:
            image_cache = Path(tmp)

        for case in cases:
            for condition in conditions:
                image_path = _perturbed_image(case, condition, image_cache)
                force = None
                if args.scenario == "wrong_amount":
                    force = {
                        "answer": case["answer"],
                        "box": case.get("truth_box"),
                        "evidence": "forced wrong log",
                        "tool_calls": [
                            {"name": "check_duplicate", "arguments": {"amount": "1"}},
                            {
                                "name": "log_expense",
                                "arguments": {
                                    "amount": "1",
                                    "currency": "IDR",
                                    "category": "meals",
                                },
                            },
                        ],
                    }
                elif args.scenario == "acted_unsure":
                    force = {
                        "answer": "unknown",
                        "box": None,
                        "evidence": "cannot read",
                        "tool_calls": [
                            {"name": "check_duplicate", "arguments": {"amount": "0"}},
                            {
                                "name": "log_expense",
                                "arguments": {
                                    "amount": "0",
                                    "currency": "IDR",
                                    "category": "meals",
                                },
                            },
                        ],
                    }
                tid = run_one(
                    ev=ev,
                    backend=backend,
                    case=case,
                    condition=condition,
                    model=args.agent,
                    session_prefix=args.session_prefix,
                    ledger=ledger,
                    image_path=image_path,
                    force_payload=force,
                )
                trace_ids.append(tid)
                total += 1
                if total % 5 == 0:
                    print(f"progress: {total} traces", flush=True)

    ev.flush(timeout=30)
    print(f"traces={len(trace_ids)} first={trace_ids[0] if trace_ids else None}")
    if trace_ids:
        print(f"trace_url={args.api_url.rstrip('/')}/api/v1/traces/{trace_ids[0]}")
    ev.close()


if __name__ == "__main__":
    main()
