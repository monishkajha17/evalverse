"""Evaluator execution: builtins, rubric judges, and rule checks."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

from evalverse import evaluators as evmod
from evalverse.server.rules import rules_need_reference, run_rules

log = logging.getLogger("evalverse.server.engine")

JudgeFn = Callable[..., tuple[str, dict]]  # (prompt, image_bytes=None, model=None) -> (text, usage)


def _parse_judge_json(text: str) -> dict | None:
    if not text:
        return None
    raw = text.strip()
    # Strip markdown fences if present.
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    # Find first {...} block.
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def extract_model_run(trace: dict[str, Any]) -> dict[str, Any]:
    """Build a pseudo `run` dict from the first completed model span output."""
    answer = ""
    box = None
    evidence = ""
    latency = None
    for sp in trace.get("spans") or []:
        if sp.get("type") != "model":
            continue
        out = sp.get("output") or {}
        if isinstance(out, dict):
            answer = str(out.get("answer") or out.get("value") or "")
            box = out.get("box")
            evidence = str(out.get("evidence") or "")[:300]
        elif isinstance(out, str):
            answer = out
        if sp.get("latency_ms") is not None:
            latency = sp["latency_ms"]
        break
    # Fallback: trace output
    if not answer and isinstance(trace.get("output"), dict):
        answer = str(trace["output"].get("total") or trace["output"].get("answer") or "")
    return {
        "answer": answer,
        "box": box,
        "evidence": evidence,
        "latency": (latency / 1000.0) if latency is not None else None,
        "error": None,
    }


def expectation_to_case(expectation: dict[str, Any] | None, trace: dict[str, Any]) -> dict[str, Any] | None:
    if not expectation:
        return None
    meta = trace.get("metadata") or {}
    case: dict[str, Any] = {
        "id": expectation.get("case_id") or meta.get("case_id") or trace.get("id") or "case",
        "answer": expectation.get("answer"),
        "answer_type": expectation.get("answer_type") or "number",
        "question": None,
    }
    if isinstance(trace.get("input"), dict):
        case["question"] = trace["input"].get("question") or trace["input"].get("text")
    if expectation.get("truth_box"):
        case["truth_box"] = list(expectation["truth_box"])
    evidence = expectation.get("evidence")
    if isinstance(evidence, dict):
        if evidence.get("type") == "image_region" and evidence.get("locator"):
            case["truth_box"] = list(evidence["locator"])
        elif evidence.get("type") == "time_span" and evidence.get("locator"):
            case["truth_span"] = evidence["locator"]
    elif isinstance(evidence, list):
        for e in evidence:
            if isinstance(e, dict) and e.get("type") == "image_region" and e.get("locator"):
                case["truth_box"] = list(e["locator"])
                break
    if expectation.get("tolerance") is not None:
        case["tolerance"] = expectation["tolerance"]
    if expectation.get("family"):
        case["family"] = expectation["family"]
    if expectation.get("menu") is not None:
        case["menu"] = expectation["menu"]
    return case


def resolve_expectation(
    trace: dict[str, Any],
    dataset_item: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    meta = trace.get("metadata") or {}
    if isinstance(meta.get("expectation"), dict):
        return meta["expectation"]
    if dataset_item:
        exp = dataset_item.get("expectation") or dataset_item.get("expected")
        if isinstance(exp, dict):
            return exp
    return None


def build_rule_context(
    trace: dict[str, Any],
    expectation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run = extract_model_run(trace)
    tool_calls = []
    for sp in trace.get("spans") or []:
        if sp.get("type") == "tool":
            tool_calls.append(
                {
                    "name": sp.get("name"),
                    "input": sp.get("input"),
                    "output": sp.get("output"),
                    "latency_ms": sp.get("latency_ms"),
                }
            )
    latency = trace.get("latency_ms")
    if latency is None:
        lats = [s.get("latency_ms") for s in (trace.get("spans") or []) if s.get("latency_ms") is not None]
        latency = max(lats) if lats else None
    return {
        "trace": {
            "id": trace.get("id"),
            "agent": trace.get("agent"),
            "status": trace.get("status"),
            "input": trace.get("input"),
            "output": trace.get("output"),
            "metadata": trace.get("metadata"),
            "tags": trace.get("tags"),
            "latency_ms": latency,
            "source": trace.get("source"),
        },
        "input": trace.get("input"),
        "output": trace.get("output"),
        "run": run,
        "answer": run.get("answer"),
        "box": run.get("box"),
        "tool_calls": tool_calls,
        "expectation": expectation or {},
        "expected": expectation or {},
        "spans": trace.get("spans") or [],
        "media": trace.get("media") or [],
    }


TOOL_USE_EVALUATOR_IDS = frozenset(
    {
        "tool_schema_valid",
        "tool_args_correct",
        "tool_args_grounded",
        "tool_order_policy",
        "action_despite_abstention",
    }
)


def run_builtin(
    evaluator_id: str,
    trace: dict[str, Any],
    expectation: dict[str, Any] | None,
) -> dict[str, Any]:
    meta = evmod.REGISTRY.get(evaluator_id)
    if meta is None:
        return {
            "status": "error",
            "score": None,
            "verdict": "not_applicable",
            "label": "error",
            "explanation": f"unknown builtin evaluator: {evaluator_id}",
            "evidence": [],
            "execution_metadata": {},
        }
    if meta.get("needs_reference") and not expectation:
        return {
            "status": "skipped",
            "score": None,
            "verdict": "not_applicable",
            "label": "skipped",
            "explanation": "no expectation",
            "evidence": [],
            "execution_metadata": {"reason": "no expectation"},
        }
    tool_spans = [s for s in (trace.get("spans") or []) if s.get("type") == "tool"]
    is_tool_eval = evaluator_id in TOOL_USE_EVALUATOR_IDS or meta.get("category") == "tool_use"
    if is_tool_eval and not tool_spans:
        return {
            "status": "skipped",
            "score": None,
            "verdict": "not_applicable",
            "label": "skipped",
            "explanation": "no tool calls",
            "evidence": [],
            "execution_metadata": {"reason": "no tool calls"},
            "evaluator_id": meta["id"],
            "evaluator_version": meta["version"],
            "dimension": meta["dimension"],
        }
    case = expectation_to_case(expectation, trace) or {"id": trace.get("id"), "answer": None}
    run = extract_model_run(trace)
    agent = trace.get("agent") or "agent"
    case_id = case.get("id") or "case"
    variant = (trace.get("metadata") or {}).get("variant") or "clean"
    out = evmod._call(
        meta,
        agent=agent,
        case_id=case_id,
        variant=variant,
        case=case,
        run=run,
        tool_spans=tool_spans,
        trace=trace,
    )
    return {
        "status": out.get("status"),
        "score": out.get("score"),
        "verdict": out.get("verdict"),
        "label": out.get("label"),
        "explanation": out.get("explanation"),
        "evidence": out.get("evidence") or [],
        "execution_metadata": out.get("execution_metadata") or {},
        "evaluator_id": meta["id"],
        "evaluator_version": meta["version"],
        "dimension": meta["dimension"],
    }


def run_rule_evaluator(config: dict[str, Any], trace: dict[str, Any], expectation: dict | None) -> dict[str, Any]:
    checks = config.get("checks") or config.get("rules") or []
    if rules_need_reference(checks) and not expectation:
        return {
            "status": "skipped",
            "score": None,
            "verdict": "not_applicable",
            "label": "skipped",
            "explanation": "no expectation",
            "evidence": [],
            "execution_metadata": {"reason": "no expectation"},
        }
    ctx = build_rule_context(trace, expectation)
    # Pre-validate paths — malicious path yields error status
    from evalverse.server.rules import RulePathError, validate_path

    for check in checks:
        if isinstance(check, dict) and check.get("path"):
            try:
                validate_path(str(check["path"]))
            except RulePathError as exc:
                return {
                    "status": "error",
                    "score": None,
                    "verdict": "not_applicable",
                    "label": "error",
                    "explanation": str(exc),
                    "evidence": [],
                    "execution_metadata": {},
                }
    result = run_rules(checks, ctx)
    result["execution_metadata"] = {"latency_ms": 0}
    return result


def _fill_prompt(template: str, trace: dict, expectation: dict | None) -> str:
    ctx = build_rule_context(trace, expectation)
    replacements = {
        "{{input}}": json.dumps(ctx.get("input"), ensure_ascii=False, default=str),
        "{{output}}": json.dumps(ctx.get("output") or ctx.get("run"), ensure_ascii=False, default=str),
        "{{tool_calls}}": json.dumps(ctx.get("tool_calls"), ensure_ascii=False, default=str),
        "{{expected}}": json.dumps(expectation or {}, ensure_ascii=False, default=str),
    }
    out = template
    for k, v in replacements.items():
        out = out.replace(k, v)
    return out


def run_rubric_evaluator(
    config: dict[str, Any],
    trace: dict[str, Any],
    expectation: dict | None,
    judge_fn: JudgeFn,
    *,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    prompt = _fill_prompt(config.get("prompt") or "", trace, expectation)
    scale = config.get("scale") or "pass_fail"
    model = config.get("judge_model") or "muse-spark-1.3"
    image_bytes = None
    if config.get("attach_media"):
        for m in trace.get("media") or []:
            path = m.get("path")
            if path:
                try:
                    from pathlib import Path

                    p = Path(path)
                    if p.is_file():
                        image_bytes = p.read_bytes()
                        break
                except OSError:
                    pass

    t0 = time.perf_counter()
    try:
        # Soft timeout: judge_fn itself should respect it; we also guard elapsed.
        text, usage = judge_fn(prompt, image_bytes=image_bytes, model=model, timeout_s=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "score": None,
            "verdict": "not_applicable",
            "label": "error",
            "explanation": f"judge failed: {exc}"[:500],
            "evidence": [],
            "execution_metadata": {
                "latency_ms": round((time.perf_counter() - t0) * 1000, 3),
                "judge_model": model,
            },
        }
    latency_ms = round((time.perf_counter() - t0) * 1000, 3)
    if latency_ms > timeout_s * 1000:
        return {
            "status": "error",
            "score": None,
            "verdict": "not_applicable",
            "label": "error",
            "explanation": f"judge timed out after {timeout_s}s",
            "evidence": [],
            "execution_metadata": {"latency_ms": latency_ms, "judge_model": model},
        }

    parsed = _parse_judge_json(text)
    if parsed is None:
        return {
            "status": "error",
            "score": None,
            "verdict": "not_applicable",
            "label": "error",
            "explanation": "invalid JSON from judge",
            "evidence": [],
            "execution_metadata": {
                "latency_ms": latency_ms,
                "judge_model": model,
                "input_tokens": (usage or {}).get("input_tokens"),
                "output_tokens": (usage or {}).get("output_tokens"),
                "raw": (text or "")[:500],
            },
        }

    score = parsed.get("score")
    label = parsed.get("label")
    explanation = str(parsed.get("explanation") or "")

    if scale == "pass_fail":
        if label is None and score is not None:
            label = "pass" if float(score) >= float(config.get("pass_threshold") or 1.0) else "fail"
        if score is None and label is not None:
            score = 1.0 if str(label).lower() in ("pass", "yes", "true") else 0.0
        verdict = "pass" if str(label).lower() in ("pass", "yes", "true") or (
            score is not None and float(score) >= float(config.get("pass_threshold") or 1.0)
        ) else "fail"
    elif scale == "labels":
        labels = config.get("labels") or []
        if label is None and score is not None:
            label = str(score)
        verdict = "pass" if label in (config.get("pass_labels") or labels[:1] or ["pass"]) else "fail"
        if score is None:
            score = 1.0 if verdict == "pass" else 0.0
    else:  # 0-1
        try:
            score = float(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        if score is None:
            return {
                "status": "error",
                "score": None,
                "verdict": "not_applicable",
                "label": "error",
                "explanation": "judge JSON missing numeric score for 0-1 scale",
                "evidence": [],
                "execution_metadata": {"latency_ms": latency_ms, "judge_model": model},
            }
        thr = float(config.get("pass_threshold") if config.get("pass_threshold") is not None else 0.5)
        verdict = "pass" if score >= thr else "fail"
        label = label or verdict

    return {
        "status": "completed",
        "score": float(score) if score is not None else None,
        "verdict": verdict,
        "label": str(label) if label is not None else verdict,
        "explanation": explanation,
        "evidence": parsed.get("evidence") or [],
        "execution_metadata": {
            "latency_ms": latency_ms,
            "judge_model": model,
            "input_tokens": (usage or {}).get("input_tokens"),
            "output_tokens": (usage or {}).get("output_tokens"),
        },
    }


def default_judge_fn(prompt: str, image_bytes=None, model: str | None = None, timeout_s: float = 30.0):
    """Live backend if MODEL_API_KEY set; otherwise a deterministic offline mock."""
    import os

    if os.environ.get("MODEL_API_KEY"):
        from evalverse.core import LiveBackend

        backend = LiveBackend()
        text, usage = backend._chat(model or "muse-spark-1.3", prompt, image_bytes)
        return text, usage

    # Offline mock: pass if prompt mentions a non-empty output / answer-like content.
    lower = prompt.lower()
    supported = ("148" in prompt) or ("total" in lower and "null" not in lower)
    payload = {
        "score": 1.0 if supported else 0.0,
        "label": "pass" if supported else "fail",
        "explanation": "mock judge: total appears supported by image context"
        if supported
        else "mock judge: insufficient support",
    }
    return json.dumps(payload), {"input_tokens": 10, "output_tokens": 20}


def rubric_needs_reference(config: dict[str, Any]) -> bool:
    prompt = config.get("prompt") or ""
    return "{{expected}}" in prompt
