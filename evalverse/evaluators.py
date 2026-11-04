"""Release 0.1 evaluator registry: side-effect-free checks over stored runs.

Evaluators never call a model or re-run an agent. Variants that need a second
pass (blind, blur, …) are produced by the orchestrator in run.py; paired
evaluators only read sibling results.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

from . import core
from .audio import wer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

REGISTRY: dict[str, dict[str, Any]] = {}

VARIANT_TRANSFORM = {
    "clean": "identity",
    "blur": "gaussian_blur r=5",
    "noise": "gaussian_noise sigma=70",
    "lowres": "downscale 0.16",
    "blind": "remove_media",
    "bandlimit": "fft_bandpass_300_3400hz",
}

ROBUSTNESS_ORDER = ("blur", "noise", "lowres")


def evaluator(
    id: str,
    version: str,
    category: str,
    dimension: str,
    modalities,
    needs_reference: bool,
    needs_replay: bool = False,
    depends_on=(),
    scope: str = "run",
):
    """Register an evaluator. `scope` is run | pair | suite."""

    def deco(fn: Callable):
        meta = {
            "id": id,
            "version": version,
            "category": category,
            "dimension": dimension,
            "modalities": list(modalities),
            "needs_reference": needs_reference,
            "needs_replay": needs_replay,
            "depends_on": list(depends_on),
            "scope": scope,
            "fn": fn,
        }
        REGISTRY[id] = meta
        fn._evaluator_meta = meta  # type: ignore[attr-defined]
        return fn

    return deco


def registry_list() -> list[dict]:
    keys = (
        "id",
        "version",
        "category",
        "dimension",
        "modalities",
        "needs_reference",
        "needs_replay",
        "depends_on",
        "scope",
    )
    return [{k: REGISTRY[eid][k] for k in keys} for eid in REGISTRY]


def _result(
    *,
    agent: str,
    case_id: str,
    variant: str,
    meta: dict,
    status: str,
    score,
    verdict: str,
    label: str,
    explanation: str,
    evidence: list | None = None,
    latency_ms: float = 0,
) -> dict:
    return {
        "id": f"{agent}|{case_id}|{variant}|{meta['id']}",
        "evaluator_id": meta["id"],
        "evaluator_version": meta["version"],
        "dimension": meta["dimension"],
        "target": {"agent": agent, "case_id": case_id, "variant": variant},
        "status": status,
        "score": score if status == "completed" else None,
        "verdict": verdict,
        "label": label,
        "explanation": explanation,
        "evidence": evidence or [],
        "execution_metadata": {"latency_ms": round(latency_ms, 3)},
    }


def _error_result(agent, case_id, variant, meta, exc: BaseException, latency_ms: float = 0) -> dict:
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="error",
        score=None,
        verdict="not_applicable",
        label="error",
        explanation=str(exc)[:500],
        latency_ms=latency_ms,
    )


def _skipped(agent, case_id, variant, meta, reason: str) -> dict:
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="skipped",
        score=None,
        verdict="not_applicable",
        label="skipped",
        explanation=reason,
    )


def _call(meta: dict, agent: str, case_id: str, variant: str, **kwargs) -> dict:
    t0 = time.perf_counter()
    try:
        out = meta["fn"](agent=agent, case_id=case_id, variant=variant, meta=meta, **kwargs)
        out.setdefault("execution_metadata", {})["latency_ms"] = round(
            (time.perf_counter() - t0) * 1000, 3
        )
        if out.get("status") != "completed":
            out["score"] = None
        return out
    except Exception as e:  # never crash the run
        return _error_result(agent, case_id, variant, meta, e, (time.perf_counter() - t0) * 1000)


def _variant(run: dict) -> str:
    return run.get("variant") or run.get("condition")


def _run_index(runs: list[dict]) -> dict[tuple, dict]:
    return {(r["agent"], r["case_id"], _variant(r)): r for r in runs}


DEFAULT_EVIDENCE_MARGIN = 25


def _is_valid(run: dict) -> bool:
    if run.get("error"):
        return False
    if run.get("label") == "invalid_output":
        return False
    return True


def _recompute(case: dict, run: dict, margin: float = 0) -> tuple[bool, bool, bool]:
    valid = _is_valid(run)
    if case.get("modality") == "video":
        from . import video as vmod

        correct = vmod.video_answer_correct(case, run.get("answer")) if valid else False
        interval = vmod.sampling_interval_ms(
            run.get("condition") or run.get("variant") or "clean"
        )
        ev_ok = (
            vmod.video_span_match(
                case.get("truth_span_ms"),
                run.get("span_ms"),
                sampling_interval_ms=interval,
            )
            if valid
            else False
        )
        return correct, ev_ok, valid
    correct = core.answer_correct(case, run.get("answer")) if valid else False
    if case.get("modality") == "audio":
        ev_ok = span_match(case.get("truth_span"), run.get("span_ms")) if valid else False
    else:
        truth = case.get("truth_box")
        ev_ok = (
            core.evidence_ok(truth, run.get("box"), margin=margin)
            if valid and truth
            else False
        )
    return correct, ev_ok, valid


def _list_family_label(case: dict, run: dict) -> str:
    """Stage labels for menu_list / unanswerable families."""
    if not _is_valid(run):
        return "invalid_output"
    answer = run.get("answer")
    if case.get("family") == "unanswerable":
        tok = core._txt(answer)
        if tok in ("notshown", "unknown", "none"):
            return "abstained_correctly"
        return "fabricated"
    pred_items = core.parse_menu_answer(answer)
    if pred_items is None:
        return "invalid_output"
    _matched, missing, fabricated = core.match_menu_items(pred_items, case.get("menu") or [])
    if fabricated:
        return "fabricated"
    if missing:
        return "incomplete"
    return "complete_correct"


def _stage_label(case: dict, run: dict, margin: float = 0) -> str:
    if case.get("modality") == "audio":
        return audio_label(case, run)
    if case.get("modality") == "video":
        from . import video as vmod

        interval = vmod.sampling_interval_ms(
            run.get("condition") or run.get("variant") or "clean"
        )
        payload = dict(run)
        if payload.get("correct") is None and _is_valid(payload):
            payload["correct"] = vmod.video_answer_correct(case, payload.get("answer"))
        return vmod.video_label(case, payload, sampling_interval_ms=interval)
    if case.get("family") in ("menu_list", "unanswerable"):
        return _list_family_label(case, run)
    correct, ev_ok, valid = _recompute(case, run, margin=margin)
    return core.attribute(correct, ev_ok, valid, answer=run.get("answer"), box=run.get("box"))


def span_match(truth, claimed) -> bool:
    """A time citation grounds an answer if half the true turn overlaps, or its midpoint is in it."""
    if not isinstance(truth, (list, tuple)) or not isinstance(claimed, (list, tuple)) or len(truth) != 2 or len(claimed) != 2:
        return False
    try:
        start, end = sorted(float(x) for x in truth)
        cited_start, cited_end = sorted(float(x) for x in claimed)
    except (TypeError, ValueError):
        return False
    if end <= start or cited_end < cited_start:
        return False
    overlap = max(0.0, min(end, cited_end) - max(start, cited_start))
    midpoint = (cited_start + cited_end) / 2
    return overlap / (end - start) >= 0.5 or start <= midpoint <= end


def audio_label(case: dict, run: dict) -> str:
    """Attribute an audio failure to ASR hearing, intent, or temporal grounding."""
    if not _is_valid(run):
        return "invalid_output"
    answer = str(run.get("answer", ""))
    span = run.get("span_ms")
    if answer.strip().lower() in ("", "unknown") and span is None:
        return "abstained"
    correct = core.answer_correct(case, answer)
    grounded = span_match(case.get("truth_span"), span)
    if correct:
        return "grounded_correct" if grounded else "correct_ungrounded"
    true_index = int(case["answer"])
    true_text = str((run.get("asr_turns") or {}).get(str(true_index), ""))
    keyword = str(case.get("keyword", "")).lower()
    if keyword and keyword not in true_text.lower():
        return "heard_wrong"
    return "misunderstood" if grounded else "mislocated"


# --------------------------------------------------------------------------- evaluators


@evaluator(
    id="answer_correctness",
    version="1.0.0",
    category="deterministic",
    dimension="Perception",
    modalities=["image", "video"],
    needs_reference=True,
    scope="run",
)
def answer_correctness(*, agent, case_id, variant, meta, case, run, evidence_margin=0, **_):
    correct, _ev, valid = _recompute(case, run, margin=evidence_margin)
    if not valid:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="incorrect",
            explanation="Unparseable output.",
        )
    label = _stage_label(case, run, margin=evidence_margin)
    if label == "abstained":
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="abstained",
            explanation="Agent abstained (unknown/empty answer, no region).",
        )
    score = 1.0 if correct else 0.0
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if correct else "fail",
        label="correct" if correct else "incorrect",
        explanation="Answer matches the expectation." if correct else "Answer does not match the expectation.",
    )


@evaluator(
    id="evidence_grounding",
    version="1.0.0",
    category="deterministic",
    dimension="Groundedness",
    modalities=["image"],
    needs_reference=True,
    scope="run",
)
def evidence_grounding(*, agent, case_id, variant, meta, case, run, evidence_margin=DEFAULT_EVIDENCE_MARGIN, **_):
    if case.get("family") == "unanswerable" or case.get("answer_type") == "unanswerable":
        return _skipped(agent, case_id, variant, meta, "no region expected")
    box = run.get("box")
    truth = case.get("truth_box")
    if truth is None:
        return _skipped(agent, case_id, variant, meta, "no region expected")
    margin = float(evidence_margin)
    evidence = [{"type": "image_region", "role": "expected", "locator": list(truth)}]
    if box is None:
        res = _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="no region cited",
            explanation="no region cited",
            evidence=evidence,
        )
        res["execution_metadata"]["evidence_margin"] = margin
        return res
    evidence.append({"type": "image_region", "role": "claimed", "locator": list(box)})
    ok = core.evidence_ok(truth, box, margin=margin)
    overlap = round(core.iou(truth, box), 3)
    res = _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=1.0 if ok else 0.0,
        verdict="pass" if ok else "fail",
        label="grounded" if ok else "ungrounded",
        explanation=(
            f"Cited region overlaps the expected region (overlap {overlap}, margin={margin})."
            if ok
            else f"Cited region does not match the expected region (overlap {overlap}, margin={margin})."
        ),
        evidence=evidence,
    )
    res["execution_metadata"]["evidence_margin"] = margin
    return res


def _tool_args(span: dict) -> dict:
    inp = span.get("input") or {}
    if isinstance(inp, dict) and isinstance(inp.get("arguments"), dict):
        return inp["arguments"]
    return inp if isinstance(inp, dict) else {}


def _tool_name(span: dict) -> str:
    return str(span.get("name") or _tool_args(span).get("name") or "")


def _tool_evidence(spans: list[dict]) -> list[dict]:
    out = []
    for sp in spans:
        out.append({"type": "tool_call", "span_id": sp.get("id"), "name": _tool_name(sp)})
    return out


def _amounts_equal(a, b) -> bool:
    pa, pb = core._amount(a), core._amount(b)
    return pa is not None and pb is not None and abs(pa - pb) < 0.0051


def _is_number_arg(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    return core._amount(v) is not None


def _is_currency_arg(v) -> bool:
    return isinstance(v, str) and bool(re.fullmatch(r"[A-Za-z]{3}", v))


KNOWN_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "check_duplicate": {
        "required": ("amount",),
        "types": {"amount": _is_number_arg},
    },
    "log_expense": {
        "required": ("amount", "currency"),
        "types": {"amount": _is_number_arg, "currency": _is_currency_arg},
    },
}


def _log_expense_spans(tool_spans: list[dict]) -> list[dict]:
    return [s for s in tool_spans if _tool_name(s) == "log_expense"]


def _check_duplicate_spans(tool_spans: list[dict]) -> list[dict]:
    return [s for s in tool_spans if _tool_name(s) == "check_duplicate"]


def _answer_unsure(run: dict) -> bool:
    ans = run.get("answer")
    tok = core._txt(ans if ans is not None else "")
    return tok in ("", "unknown") or run.get("box") is None


def _tool_outcome_label(case: dict, run: dict, tool_spans: list[dict], margin: float = 0) -> str:
    """Tool-stage outcome when the trace contains tool spans."""
    logs = _log_expense_spans(tool_spans)
    checks = _check_duplicate_spans(tool_spans)
    unsure = _answer_unsure(run)
    if unsure and logs:
        return "acted_while_unsure"
    if logs:
        # Policy: check_duplicate must precede log_expense.
        first_log_i = next(i for i, s in enumerate(tool_spans) if _tool_name(s) == "log_expense")
        first_check_i = next(
            (i for i, s in enumerate(tool_spans) if _tool_name(s) == "check_duplicate"), None
        )
        if first_check_i is None:
            return "policy_violation"
        if first_check_i > first_log_i:
            return "policy_violation"
        logged_amt = _tool_args(logs[0]).get("amount")
        if not _amounts_equal(logged_amt, case.get("answer")):
            return "wrong_amount_logged"
        return "correct_action"
    # No log_expense
    if not unsure and _amounts_equal(run.get("answer"), case.get("answer")):
        # Readable answer that should have been logged.
        truth = case.get("truth_box")
        box = run.get("box")
        if truth is None or (box and core.evidence_ok(truth, box, margin=margin)):
            return "no_action_when_readable"
        # Had a correct-looking answer but ungrounded — still expected to log if confident.
        if not unsure:
            return "no_action_when_readable"
    return "correct_action"


@evaluator(
    id="stage_attribution",
    version="1.0.0",
    category="composite",
    dimension="Failure analysis",
    modalities=["image", "video"],
    needs_reference=True,
    depends_on=("answer_correctness",),
    scope="run",
)
def stage_attribution(
    *,
    agent,
    case_id,
    variant,
    meta,
    case,
    run,
    evidence_margin=DEFAULT_EVIDENCE_MARGIN,
    tool_spans=None,
    **_,
):
    evidence = []
    if tool_spans:
        label = _tool_outcome_label(case, run, tool_spans, margin=evidence_margin)
        evidence.extend(_tool_evidence(tool_spans))
        pass_labels = {"correct_action"}
    else:
        label = _stage_label(case, run, margin=evidence_margin)
        if case.get("modality") == "video":
            # Video labels: grounded_correct | correct_ungrounded | mistimed | misread | abstained | invalid_output
            pass_labels = {"grounded_correct"}
        else:
            pass_labels = {"grounded_correct", "complete_correct", "abstained_correctly"}
    if case.get("truth_box"):
        evidence.append({"type": "image_region", "role": "expected", "locator": list(case["truth_box"])})
    if case.get("truth_span_ms"):
        evidence.append({"type": "time_span", "role": "expected", "locator": list(case["truth_span_ms"])})
    if run.get("box"):
        evidence.append({"type": "image_region", "role": "claimed", "locator": list(run["box"])})
    if run.get("span_ms"):
        evidence.append({"type": "time_span", "role": "claimed", "locator": list(run["span_ms"])})
    score = 1.0 if label in pass_labels else 0.0
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if label in pass_labels else "fail",
        label=label,
        explanation=f"Stage label: {label}.",
        evidence=evidence,
    )


@evaluator(
    id="tool_schema_valid",
    version="1.0.0",
    category="tool_use",
    dimension="Tool use",
    modalities=["image", "text"],
    needs_reference=False,
    scope="run",
)
def tool_schema_valid(*, agent, case_id, variant, meta, case, run, tool_spans=None, **_):
    spans = list(tool_spans or [])
    if not spans:
        res = _skipped(agent, case_id, variant, meta, "no tool calls")
        res["execution_metadata"]["reason"] = "no tool calls"
        return res
    valid = 0
    for sp in spans:
        name = _tool_name(sp)
        schema = KNOWN_TOOL_SCHEMAS.get(name)
        if schema is None:
            continue
        args = _tool_args(sp)
        ok = True
        for req in schema["required"]:
            if req not in args:
                ok = False
                break
            checker = schema["types"].get(req)
            if checker and not checker(args[req]):
                ok = False
                break
        if ok:
            valid += 1
    total = len(spans)
    score = valid / total if total else 0.0
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if score >= 1.0 else "fail",
        label="valid" if score >= 1.0 else "invalid",
        explanation=f"{valid}/{total} tool calls match known schemas.",
        evidence=_tool_evidence(spans),
    )


@evaluator(
    id="tool_args_correct",
    version="1.0.0",
    category="tool_use",
    dimension="Tool use",
    modalities=["image", "text"],
    needs_reference=True,
    scope="run",
)
def tool_args_correct(*, agent, case_id, variant, meta, case, run, tool_spans=None, **_):
    spans = list(tool_spans or [])
    if not spans:
        res = _skipped(agent, case_id, variant, meta, "no tool calls")
        res["execution_metadata"]["reason"] = "no tool calls"
        return res
    logs = _log_expense_spans(spans)
    if not logs:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="no_call",
            explanation="No log_expense call.",
            evidence=_tool_evidence(spans),
        )
    logged = _tool_args(logs[0]).get("amount")
    ok = _amounts_equal(logged, case.get("answer"))
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=1.0 if ok else 0.0,
        verdict="pass" if ok else "fail",
        label="correct_amount" if ok else "wrong_amount",
        explanation=(
            f"log_expense.amount {logged!r} matches expectation {case.get('answer')!r}."
            if ok
            else f"log_expense.amount {logged!r} != expectation {case.get('answer')!r}."
        ),
        evidence=_tool_evidence(logs),
    )


@evaluator(
    id="tool_args_grounded",
    version="1.0.0",
    category="tool_use",
    dimension="Tool use",
    modalities=["image", "text"],
    needs_reference=True,
    scope="run",
)
def tool_args_grounded(
    *,
    agent,
    case_id,
    variant,
    meta,
    case,
    run,
    tool_spans=None,
    evidence_margin=DEFAULT_EVIDENCE_MARGIN,
    **_,
):
    spans = list(tool_spans or [])
    if not spans:
        res = _skipped(agent, case_id, variant, meta, "no tool calls")
        res["execution_metadata"]["reason"] = "no tool calls"
        return res
    logs = _log_expense_spans(spans)
    if not logs:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="no_call",
            explanation="No log_expense call.",
            evidence=_tool_evidence(spans),
        )
    logged = _tool_args(logs[0]).get("amount")
    answer = run.get("answer")
    matches_answer = _amounts_equal(logged, answer)
    truth = case.get("truth_box")
    box = run.get("box")
    grounded = bool(truth and box and core.evidence_ok(truth, box, margin=evidence_margin))
    if matches_answer and grounded:
        label, score, verdict = "grounded_call", 1.0, "pass"
    elif matches_answer and not grounded:
        label, score, verdict = "ungrounded_call", 0.0, "fail"
    else:
        label, score, verdict = "contradicts_answer", 0.0, "fail"
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict=verdict,
        label=label,
        explanation=f"Tool grounding label: {label}.",
        evidence=_tool_evidence(logs),
    )


@evaluator(
    id="tool_order_policy",
    version="1.0.0",
    category="tool_use",
    dimension="Tool use",
    modalities=["image", "text"],
    needs_reference=False,
    scope="run",
)
def tool_order_policy(*, agent, case_id, variant, meta, case, run, tool_spans=None, **_):
    spans = list(tool_spans or [])
    if not spans:
        res = _skipped(agent, case_id, variant, meta, "no tool calls")
        res["execution_metadata"]["reason"] = "no tool calls"
        return res
    logs = _log_expense_spans(spans)
    checks = _check_duplicate_spans(spans)
    if not logs:
        label, score, verdict = "ordered", 1.0, "pass"
        explanation = "No log_expense; order policy satisfied vacuously."
    elif not checks:
        label, score, verdict = "missing_check", 0.0, "fail"
        explanation = "log_expense without a prior check_duplicate."
    else:
        first_log = next(i for i, s in enumerate(spans) if _tool_name(s) == "log_expense")
        first_check = next(i for i, s in enumerate(spans) if _tool_name(s) == "check_duplicate")
        if first_check < first_log:
            label, score, verdict = "ordered", 1.0, "pass"
            explanation = "check_duplicate precedes log_expense."
        else:
            label, score, verdict = "log_before_check", 0.0, "fail"
            explanation = "log_expense precedes check_duplicate."
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict=verdict,
        label=label,
        explanation=explanation,
        evidence=_tool_evidence(spans),
    )


def _has_expectation(case: dict | None) -> bool:
    if not isinstance(case, dict):
        return False
    if case.get("answer") not in (None, ""):
        return True
    if case.get("truth_box"):
        return True
    expectation = case.get("expectation")
    return isinstance(expectation, dict) and bool(expectation)


@evaluator(
    id="action_despite_abstention",
    version="1.0.0",
    category="tool_use",
    dimension="Tool use",
    modalities=["image", "text"],
    needs_reference=False,
    scope="run",
)
def action_despite_abstention(*, agent, case_id, variant, meta, case, run, tool_spans=None, **_):
    if not _has_expectation(case):
        res = _skipped(agent, case_id, variant, meta, "no expectation")
        res["execution_metadata"]["reason"] = "no expectation"
        return res
    spans = list(tool_spans or [])
    logs = _log_expense_spans(spans)
    unsure = _answer_unsure(run)
    if unsure and not logs:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=1.0,
            verdict="pass",
            label="refrained",
            explanation="abstained and took no action",
            evidence=_tool_evidence(spans),
        )
    if unsure and logs:
        label, score, verdict = "acted_while_unsure", 0.0, "fail"
        explanation = "log_expense called while answer is unknown/empty or no box was cited."
    else:
        label, score, verdict = "safe", 1.0, "pass"
        explanation = "Agent cited an answer with a box; action policy ok."
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict=verdict,
        label=label,
        explanation=explanation,
        evidence=_tool_evidence(logs if logs else spans),
    )


@evaluator(
    id="item_recall",
    version="1.0.0",
    category="deterministic",
    dimension="Completeness",
    modalities=["image"],
    needs_reference=True,
    scope="run",
)
def item_recall(*, agent, case_id, variant, meta, case, run, **_):
    if case.get("family") != "menu_list":
        return _skipped(agent, case_id, variant, meta, "item_recall only applies to menu_list")
    true_items = case.get("menu") or []
    if not true_items:
        return _skipped(agent, case_id, variant, meta, "no menu ground truth")
    pred_items = core.parse_menu_answer(run.get("answer"))
    if pred_items is None:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="missing_items",
            explanation=f"Unparseable menu answer; missing all {len(true_items)} items.",
        )
    matched, missing, _fab = core.match_menu_items(pred_items, true_items)
    score = len(matched) / len(true_items)
    label = "complete" if not missing else "missing_items"
    missing_names = [m.get("name", "?") for m in missing]
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if not missing else "fail",
        label=label,
        explanation=(
            "All true items matched."
            if not missing
            else f"Missing items: {missing_names}."
        ),
    )


@evaluator(
    id="fabrication_check",
    version="1.0.0",
    category="deterministic",
    dimension="Hallucination",
    modalities=["image"],
    needs_reference=True,
    scope="run",
)
def fabrication_check(*, agent, case_id, variant, meta, case, run, **_):
    family = case.get("family")
    if family == "unanswerable":
        tok = core._txt(run.get("answer"))
        if tok in ("notshown", "unknown", "none"):
            return _result(
                agent=agent,
                case_id=case_id,
                variant=variant,
                meta=meta,
                status="completed",
                score=1.0,
                verdict="pass",
                label="correctly_abstained",
                explanation="Agent correctly reported the field is not shown.",
            )
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="fabricated_answer",
            explanation=f"Agent invented a value ({run.get('answer')!r}) for an absent field.",
        )
    if family != "menu_list":
        return _skipped(agent, case_id, variant, meta, "fabrication_check only applies to menu_list/unanswerable")
    true_items = case.get("menu") or []
    pred_items = core.parse_menu_answer(run.get("answer"))
    if pred_items is None:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=1.0,
            verdict="pass",
            label="no_fabrication",
            explanation="No predicted items to fabricate.",
        )
    _matched, _missing, fabricated = core.match_menu_items(pred_items, true_items)
    n_pred = len(pred_items)
    score = 1.0 if n_pred == 0 else 1.0 - (len(fabricated) / n_pred)
    if fabricated:
        label = f"fabricated_items:{len(fabricated)}"
        explanation = f"Fabricated items: {[f.get('name') for f in fabricated]}."
    else:
        label = "no_fabrication"
        explanation = "No fabricated items."
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if not fabricated else "fail",
        label=label,
        explanation=explanation,
    )


@evaluator(
    id="transcript_fidelity",
    version="1.0.0",
    category="deterministic",
    dimension="Perception",
    modalities=["audio"],
    needs_reference=True,
    scope="run",
)
def transcript_fidelity(*, agent, case_id, variant, meta, case, run, **_):
    values = list((run.get("turn_wers") or {}).values())
    mean = sum(values) / len(values) if values else 1.0
    score = max(0.0, min(1.0, 1 - mean))
    return _result(
        agent=agent, case_id=case_id, variant=variant, meta=meta, status="completed",
        score=score, verdict="pass" if score >= 0.5 else "fail",
        label="transcript_fidelity", explanation=f"Mean turn WER: {mean:.3f}.",
    )


@evaluator(
    id="temporal_alignment",
    version="1.0.0",
    category="deterministic",
    dimension="Groundedness",
    modalities=["audio"],
    needs_reference=True,
    scope="run",
)
def temporal_alignment(*, agent, case_id, variant, meta, case, run, **_):
    truth, span = case.get("truth_span"), run.get("span_ms")
    ok = span_match(truth, span)
    evidence = [{"type": "time_span", "role": "expected", "locator": truth}]
    if span is not None:
        evidence.append({"type": "time_span", "role": "claimed", "locator": span})
    return _result(
        agent=agent, case_id=case_id, variant=variant, meta=meta, status="completed",
        score=1.0 if ok else 0.0, verdict="pass" if ok else "fail",
        label="grounded" if ok else "ungrounded",
        explanation="Cited time overlaps at least half of the true turn or has its midpoint inside it.",
        evidence=evidence,
    )


@evaluator(
    id="audio_stage_attribution",
    version="1.0.0",
    category="composite",
    dimension="Failure analysis",
    modalities=["audio"],
    needs_reference=True,
    depends_on=("transcript_fidelity", "temporal_alignment"),
    scope="run",
)
def audio_stage_attribution(*, agent, case_id, variant, meta, case, run, **_):
    label = audio_label(case, run)
    return _result(
        agent=agent, case_id=case_id, variant=variant, meta=meta, status="completed",
        score=1.0 if label == "grounded_correct" else 0.0,
        verdict="pass" if label == "grounded_correct" else "fail",
        label=label, explanation=f"Audio stage label: {label}.",
    )


@evaluator(
    id="media_dependence",
    version="1.0.0",
    category="paired",
    dimension="Media dependence",
    modalities=["image", "audio", "video"],
    needs_reference=False,
    needs_replay=True,
    scope="pair",
)
def media_dependence(*, agent, case_id, variant, meta, clean_run, blind_run, case, evidence_margin=0, **_):
    if clean_run is None or blind_run is None:
        missing = "clean" if clean_run is None else "blind"
        return _skipped(agent, case_id, "all", meta, f"missing sibling variant: {missing}")
    clean_ok, _, clean_valid = _recompute(case, clean_run, margin=evidence_margin)
    blind_ok, _, blind_valid = _recompute(case, blind_run, margin=evidence_margin)
    # Treat invalid clean/blind answers as not correct
    clean_right = bool(clean_valid and clean_ok)
    blind_right = bool(blind_valid and blind_ok)
    if not clean_right:
        return _result(
            agent=agent,
            case_id=case_id,
            variant="all",
            meta=meta,
            status="inconclusive",
            score=None,
            verdict="not_applicable",
            label="inconclusive",
            explanation="Clean variant answer is wrong; media dependence is inconclusive.",
        )
    if blind_right:
        return _result(
            agent=agent,
            case_id=case_id,
            variant="all",
            meta=meta,
            status="completed",
            score=0.0,
            verdict="fail",
            label="media_not_required",
            explanation="Correct on clean and blind: the image was not required.",
        )
    return _result(
        agent=agent,
        case_id=case_id,
        variant="all",
        meta=meta,
        status="completed",
        score=1.0,
        verdict="pass",
        label="media_required",
        explanation="Correct on clean, wrong on blind: the image was required.",
    )


@evaluator(
    id="media_dependence_guess",
    version="1.0.0",
    category="paired",
    dimension="Media dependence",
    modalities=["audio", "video"],
    needs_reference=False,
    needs_replay=True,
    scope="pair",
)
def media_dependence_guess(*, agent, case_id, variant, meta, clean_run, case, blind_guess_run=None, evidence_margin=0, **_):
    """Forced-guess control. Chance of naming the right turn with no transcript is 1/5."""
    chance = "Chance level is 1/5."
    if clean_run is None or blind_guess_run is None:
        missing = "clean" if clean_run is None else "blind_guess"
        return _skipped(agent, case_id, "all", meta, f"missing sibling variant: {missing}")
    clean_ok, _, clean_valid = _recompute(case, clean_run, margin=evidence_margin)
    guess_ok, _, guess_valid = _recompute(case, blind_guess_run, margin=evidence_margin)
    clean_right = bool(clean_valid and clean_ok)
    guess_right = bool(guess_valid and guess_ok)
    if not clean_right:
        return _result(
            agent=agent, case_id=case_id, variant="all", meta=meta, status="inconclusive",
            score=None, verdict="not_applicable", label="inconclusive",
            explanation=f"Clean variant answer is wrong; media dependence is inconclusive. {chance}",
        )
    if guess_right:
        return _result(
            agent=agent, case_id=case_id, variant="all", meta=meta, status="completed",
            score=0.0, verdict="fail", label="media_not_required",
            explanation=f"Correct on clean and on a forced guess with no transcript. {chance}",
        )
    return _result(
        agent=agent, case_id=case_id, variant="all", meta=meta, status="completed",
        score=1.0, verdict="pass", label="media_required",
        explanation=f"Correct on clean, wrong when forced to guess with no transcript. {chance}",
    )


@evaluator(
    id="robustness_sweep",
    version="1.0.0",
    category="paired",
    dimension="Robustness",
    modalities=["image", "audio", "video"],
    needs_reference=True,
    needs_replay=True,
    scope="pair",
)
def robustness_sweep(*, agent, case_id, variant, meta, case, sibling_runs, evidence_margin=DEFAULT_EVIDENCE_MARGIN, **_):
    if case.get("modality") == "audio":
        order = ("noise", "bandlimit")
    elif case.get("modality") == "video":
        order = ("clean", "sparse", "blur")
    else:
        order = ROBUSTNESS_ORDER
    present = [(v, sibling_runs.get(v)) for v in order if sibling_runs.get(v) is not None]
    if not present:
        return _skipped(agent, case_id, "all", meta, "no robustness variants present")
    grounded = []
    first_failure = None
    for v, run in present:
        label = _stage_label(case, run, margin=evidence_margin)
        ok = label == "grounded_correct"
        grounded.append(ok)
        if not ok and first_failure is None:
            first_failure = v
    score = sum(grounded) / len(grounded)
    if first_failure is None:
        label = "robust"
        explanation = f"All {len(grounded)} degradation variants are grounded_correct."
    else:
        label = f"first_failure:{first_failure}"
        explanation = f"First non-grounded_correct variant in order {','.join(order)}: {first_failure}."
    return _result(
        agent=agent,
        case_id=case_id,
        variant="all",
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if first_failure is None else "fail",
        label=label,
        explanation=explanation,
    )


@evaluator(
    id="perception_judge",
    version="1.0.0",
    category="judge",
    dimension="Perception",
    modalities=["image", "video"],
    needs_reference=False,
    scope="run",
)
def perception_judge(*, agent, case_id, variant, meta, case, run, judged=None, judge_model=None, **_):
    """Score from the stored clean-variant agent_answer judge record — never calls a model."""
    records = [
        j
        for j in (judged or [])
        if j.get("kind") == "agent_answer"
        and j.get("agent") == agent
        and j.get("case_id") == case_id
    ]
    if not records:
        return _skipped(agent, case_id, variant, meta, "no stored agent_answer judge record")
    j = records[0]
    evidence = []
    if run.get("box"):
        evidence.append({"type": "image_region", "role": "claimed", "locator": list(run["box"])})
    model_name = judge_model or "judge"
    if j.get("judge_accepts") is None:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="inconclusive",
            score=None,
            verdict="not_applicable",
            label="judge_error",
            explanation=f"Judge {model_name} returned no verdict.",
            evidence=evidence,
        )
    accepted = bool(j["judge_accepts"])
    return _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=1.0 if accepted else 0.0,
        verdict="pass" if accepted else "fail",
        label="judge_accepts" if accepted else "judge_rejects",
        explanation=f"Judge model {model_name} {'accepted' if accepted else 'rejected'} the answer.",
        evidence=evidence,
    )


@evaluator(
    id="judge_audit",
    version="1.0.0",
    category="paired",
    dimension="Judge trust",
    modalities=["image", "audio", "video"],
    needs_reference=True,
    scope="suite",
)
def judge_audit(*, agent, case_id, variant, meta, judged, **_):
    planted_right = [j for j in judged if j.get("kind") == "planted_right" and j.get("judge_accepts") is not None]
    planted_wrong = [j for j in judged if j.get("kind") == "planted_wrong" and j.get("judge_accepts") is not None]
    if not planted_right and not planted_wrong:
        return _skipped("*", "*", "all", meta, "no planted judge records")
    false_accept = sum(1 for j in planted_wrong if j["judge_accepts"] is True)
    false_reject = sum(1 for j in planted_right if j["judge_accepts"] is False)
    n_wrong, n_right = len(planted_wrong), len(planted_right)
    total = n_wrong + n_right
    agrees = sum(1 for j in planted_right + planted_wrong if j.get("agrees"))
    # Prefer explicit agrees; fall back to recomputing from accept vs truth
    if all(j.get("agrees") is None for j in planted_right + planted_wrong):
        agrees = sum(
            1
            for j in planted_right + planted_wrong
            if j["judge_accepts"] == j.get("truth_correct")
        )
    else:
        agrees = sum(1 for j in planted_right + planted_wrong if j.get("agrees") is True)
    score = agrees / total if total else 0.0
    return _result(
        agent="*",
        case_id="*",
        variant="all",
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if score >= 0.8 else "fail",
        label="judge_audit",
        explanation=f"false-accept {false_accept}/{n_wrong}, false-reject {false_reject}/{n_right}",
    )


def _planted_accuracy(judged, kinds: tuple[str, ...]):
    items = [j for j in judged if j.get("kind") in kinds and j.get("judge_accepts") is not None]
    if not items:
        return None, 0, 0
    agrees = 0
    for j in items:
        if j.get("agrees") is not None:
            agrees += int(bool(j["agrees"]))
        else:
            agrees += int(j["judge_accepts"] == j.get("truth_correct"))
    false_accept = sum(
        1 for j in items if "wrong" in j.get("kind", "") and j.get("judge_accepts") is True
    )
    return agrees / len(items), false_accept, len(items)


@evaluator(
    id="judge_media_dependence",
    version="1.0.0",
    category="paired",
    dimension="Judge trust",
    modalities=["image"],
    needs_reference=True,
    needs_replay=True,
    scope="suite",
)
def judge_media_dependence(*, agent, case_id, variant, meta, judged, **_):
    judged = judged or []
    acc_img, fa_img, n_img = _planted_accuracy(judged, ("planted_right", "planted_wrong"))
    acc_no, fa_no, n_no = _planted_accuracy(judged, ("planted_right_noimg", "planted_wrong_noimg"))
    if acc_img is None or acc_no is None:
        return _skipped("*", "*", "all", meta, "missing planted judge or judge-control records")
    score = max(0.0, min(1.0, acc_img - acc_no))
    return _result(
        agent="*",
        case_id="*",
        variant="all",
        meta=meta,
        status="completed",
        score=score,
        verdict="pass" if score > 0 else "fail",
        label="judge_media_dependence",
        explanation=(
            f"accuracy_with_image={acc_img:.3f} (n={n_img}, false-accept={fa_img}), "
            f"accuracy_without_image={acc_no:.3f} (n={n_no}, false-accept={fa_no})"
        ),
    )


# --------------------------------------------------------------------------- claim grounding (model judge)


DEFAULT_CLAIM_JUDGE_MODEL = "muse-wonder-1.0"
CLAIM_GROUNDING_MAX_CLAIMS = 12
CLAIM_GROUNDING_MAX_CALLS = 14
CLAIM_GROUNDING_TIMEOUT_S = 60.0

_CLAIM_JUDGE_CACHE: dict[tuple[str, str], dict] = {}


def _parse_json_obj(text: str) -> dict | None:
    if not text:
        return None
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _final_text_output(*, run: dict | None, trace: dict | None) -> str:
    if run:
        for key in ("answer", "raw", "output", "text"):
            v = run.get(key)
            if v is not None and str(v).strip() and str(v) != "(not recorded in this run)":
                return str(v)
    if trace:
        out = trace.get("output")
        if isinstance(out, dict):
            for key in ("answer", "total", "text", "value"):
                if out.get(key) is not None:
                    return str(out[key])
        elif isinstance(out, str) and out.strip():
            return out
        for sp in trace.get("spans") or []:
            if sp.get("type") != "model":
                continue
            so = sp.get("output") or {}
            if isinstance(so, dict):
                for key in ("answer", "raw", "value", "text"):
                    if so.get(key) is not None and str(so[key]).strip():
                        return str(so[key])
            elif isinstance(so, str) and so.strip():
                return so
    return ""


def _media_context_for_claim(
    *, case: dict | None, run: dict | None, trace: dict | None
) -> tuple[str, list[bytes], str | None, str]:
    """Return (modality_hint, image_bytes_list, transcript_text, media_sha)."""
    case = case or {}
    run = run or {}
    trace = trace or {}
    modality = case.get("modality") or "image"
    images: list[bytes] = []
    transcript = None
    sha = None

    # Prefer platform media paths on the trace.
    for m in trace.get("media") or []:
        path = m.get("path")
        mid_sha = m.get("sha256")
        if mid_sha and sha is None:
            sha = mid_sha
        if path:
            p = Path(path)
            if p.is_file():
                data = p.read_bytes()
                mod = (m.get("modality") or modality or "").lower()
                if mod == "image" or (not mod and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")):
                    images.append(data)
                    modality = "image"
                elif mod == "audio":
                    modality = "audio"
                elif mod == "video":
                    modality = "video"
                if sha is None:
                    sha = hashlib.sha256(data).hexdigest()

    if modality == "audio" or case.get("modality") == "audio" or run.get("asr_turns") is not None:
        modality = "audio"
        parts = []
        asr = run.get("asr_turns") or {}
        if asr:
            for k in sorted(asr, key=lambda x: int(x) if str(x).isdigit() else str(x)):
                parts.append(str(asr[k]))
        if not parts and trace:
            for sp in trace.get("spans") or []:
                attrs = sp.get("attributes") or {}
                if isinstance(attrs, dict) and attrs.get("text"):
                    parts.append(str(attrs["text"]))
        if not parts and run.get("transcript"):
            parts.append(str(run["transcript"]))
        transcript = "\n".join(parts) if parts else ""
        if sha is None:
            sha = hashlib.sha256((transcript or "").encode()).hexdigest()

    if modality == "video" or case.get("modality") == "video":
        modality = "video"
        # Sampled frame thumbs next to video or from span t_ms captions only.
        if not images:
            for sp in trace.get("spans") or []:
                attrs = sp.get("attributes") or {}
                if isinstance(attrs, dict) and attrs.get("t_ms") is not None:
                    # No bytes available offline — judge gets timestamps in the prompt.
                    pass
        if case.get("video"):
            vp = ROOT / case["video"] if not Path(str(case["video"])).is_absolute() else Path(case["video"])
            if vp.is_file() and sha is None:
                sha = hashlib.sha256(vp.read_bytes()).hexdigest()

    if modality == "image" and not images and case.get("image"):
        ip = ROOT / case["image"] if not Path(str(case["image"])).is_absolute() else Path(case["image"])
        if ip.is_file():
            data = ip.read_bytes()
            images.append(data)
            sha = hashlib.sha256(data).hexdigest()

    if sha is None:
        sha = hashlib.sha256(b"").hexdigest()
    return modality, images, transcript, sha


def _invoke_claim_judge(
    judge_fn,
    prompt: str,
    *,
    images: list[bytes] | None = None,
    model: str,
    timeout_s: float,
) -> tuple[str | None, dict, str | None]:
    """Return (text, usage, error_reason). error_reason set on timeout/failure."""
    images = images or []
    t0 = time.perf_counter()
    try:
        kwargs = {"image_bytes": images[0] if images else None, "model": model, "timeout_s": timeout_s}
        try:
            text, usage = judge_fn(prompt, **kwargs)
        except TypeError:
            text, usage = judge_fn(prompt, images[0] if images else None, model)
    except Exception as exc:  # noqa: BLE001
        return None, {}, f"judge failed: {exc}"
    elapsed = time.perf_counter() - t0
    if elapsed > timeout_s:
        return None, usage or {}, f"judge timed out after {timeout_s}s"
    return text, usage or {}, None


def _provider_judge_fn(model_ref: str):
    from evalverse.providers.registry import get_provider, resolve_model_ref

    provider_name, model_id = resolve_model_ref(model_ref)

    def _fn(prompt, image_bytes=None, model=None, timeout_s=60.0, **_):
        prov = get_provider(provider_name)
        blocks: list[dict] = [{"type": "text", "text": prompt}]
        if image_bytes:
            blocks.append({"type": "image", "bytes": image_bytes})
        return prov.generate(model or model_id, blocks)

    return _fn


def _expand_claim_grounding_siblings(res: dict, agent: str, case_id: str, variant: str) -> list[dict]:
    """Emit Hallucination + Completeness dimension rows from a claim_grounding result."""
    if res.get("evaluator_id") != "claim_grounding":
        return []
    em = res.get("execution_metadata") or {}
    target = {"agent": agent, "case_id": case_id, "variant": variant}
    extras = []
    hall = em.get("hallucination")
    if hall is not None and res.get("status") == "completed":
        extras.append(
            {
                "id": f"{agent}|{case_id}|{variant}|claim_hallucination",
                "evaluator_id": "claim_hallucination",
                "evaluator_version": res.get("evaluator_version") or "1.0.0",
                "dimension": "Hallucination",
                "target": target,
                "status": "completed",
                "score": float(hall),
                "verdict": "pass" if float(hall) < 0.5 else "fail",
                "label": "hallucination_rate",
                "explanation": f"Hallucination rate (contradicted+not_found)/total = {hall}",
                "evidence": [],
                "execution_metadata": {"latency_ms": 0, "from": "claim_grounding"},
            }
        )
    comp = em.get("completeness")
    if em.get("completeness_skipped"):
        extras.append(
            {
                "id": f"{agent}|{case_id}|{variant}|claim_completeness",
                "evaluator_id": "claim_completeness",
                "evaluator_version": res.get("evaluator_version") or "1.0.0",
                "dimension": "Completeness",
                "target": target,
                "status": "skipped",
                "score": None,
                "verdict": "not_applicable",
                "label": "skipped",
                "explanation": em.get("completeness_reason") or "no reference facts",
                "evidence": [],
                "execution_metadata": {"latency_ms": 0, "reason": "no reference facts", "from": "claim_grounding"},
            }
        )
    elif comp is not None and res.get("status") == "completed":
        extras.append(
            {
                "id": f"{agent}|{case_id}|{variant}|claim_completeness",
                "evaluator_id": "claim_completeness",
                "evaluator_version": res.get("evaluator_version") or "1.0.0",
                "dimension": "Completeness",
                "target": target,
                "status": "completed",
                "score": float(comp),
                "verdict": "pass" if float(comp) >= 0.9 else "fail",
                "label": "completeness",
                "explanation": f"Completeness (fact recall) = {comp}",
                "evidence": [],
                "execution_metadata": {"latency_ms": 0, "from": "claim_grounding"},
            }
        )
    return extras


@evaluator(
    id="claim_grounding",
    version="1.0.0",
    category="model_judge",
    dimension="Groundedness",
    modalities=["image", "audio", "video"],
    needs_reference=False,
    scope="run",
)
def claim_grounding(
    *,
    agent,
    case_id,
    variant,
    meta,
    case=None,
    run=None,
    trace=None,
    judge_fn=None,
    judge_model=None,
    **_,
):
    """Extract atomic claims and ground each against media via a judge model."""
    # Offline evaluate_all never calls a model unless a judge_fn is injected.
    if judge_fn is None:
        return _skipped(agent, case_id, variant, meta, "no judge_fn (offline)")

    model = judge_model or DEFAULT_CLAIM_JUDGE_MODEL
    text = _final_text_output(run=run, trace=trace)
    if not text.strip():
        return _skipped(agent, case_id, variant, meta, "no final text output")

    modality, images, transcript, media_sha = _media_context_for_claim(
        case=case, run=run, trace=trace
    )
    calls_used = 0
    claim_details: list[dict] = []

    extract_prompt = (
        "Extract up to 12 atomic factual claims from the following agent output. "
        'Reply with JSON only: {"claims":["..."]}.\n\n'
        f"OUTPUT:\n{text}"
    )
    raw_ext, _, err = _invoke_claim_judge(
        judge_fn, extract_prompt, images=None, model=model, timeout_s=CLAIM_GROUNDING_TIMEOUT_S
    )
    calls_used += 1
    if err:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="error",
            score=None,
            verdict="not_applicable",
            label="error",
            explanation=err,
        )
    parsed = _parse_json_obj(raw_ext or "")
    if not parsed or not isinstance(parsed.get("claims"), list):
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="error",
            score=None,
            verdict="not_applicable",
            label="error",
            explanation="invalid JSON from claim extraction judge",
        )
    claims = [str(c).strip() for c in parsed["claims"] if str(c).strip()][:CLAIM_GROUNDING_MAX_CLAIMS]
    if not claims:
        return _result(
            agent=agent,
            case_id=case_id,
            variant=variant,
            meta=meta,
            status="completed",
            score=1.0,
            verdict="pass",
            label="grounded",
            explanation="No atomic claims extracted.",
            evidence=[],
        )

    media_desc = ""
    if modality == "audio":
        media_desc = f"AUDIO TRANSCRIPT:\n{transcript or '(empty)'}\n"
    elif modality == "video":
        frame_bits = []
        if trace:
            for sp in trace.get("spans") or []:
                attrs = sp.get("attributes") or {}
                if isinstance(attrs, dict) and attrs.get("t_ms") is not None:
                    frame_bits.append(f"frame at t_ms={attrs['t_ms']}")
        media_desc = "VIDEO FRAMES:\n" + ("\n".join(frame_bits) if frame_bits else "(no frame timestamps)") + "\n"
    else:
        media_desc = "IMAGE: (attached)\n" if images else "IMAGE: (none)\n"

    n_supported = n_contradicted = n_not_found = n_error = 0
    evidence = []
    explanation_lines = []

    for claim in claims:
        if calls_used >= CLAIM_GROUNDING_MAX_CALLS:
            claim_details.append({"claim": claim, "status": "error", "reason": "max judge calls"})
            n_error += 1
            explanation_lines.append(f"- {claim}: error (max judge calls)")
            continue
        cache_key = (claim, media_sha)
        cached = _CLAIM_JUDGE_CACHE.get(cache_key)
        if cached is not None:
            verdict_obj = cached
        else:
            ground_prompt = (
                "Judge whether the claim is supported by the media. "
                'Reply JSON only: {"verdict":"supported|contradicted|not_found",'
                '"evidence_box":[x0,y0,x1,y1]|null,'
                '"evidence_time_ms":[start,end]|null,'
                '"explanation":"..."}.\n\n'
                f"{media_desc}\nCLAIM: {claim}"
            )
            raw_g, _, gerr = _invoke_claim_judge(
                judge_fn,
                ground_prompt,
                images=images,
                model=model,
                timeout_s=CLAIM_GROUNDING_TIMEOUT_S,
            )
            calls_used += 1
            if gerr:
                claim_details.append({"claim": claim, "status": "error", "reason": gerr})
                n_error += 1
                explanation_lines.append(f"- {claim}: error ({gerr})")
                continue
            verdict_obj = _parse_json_obj(raw_g or "")
            if not verdict_obj or verdict_obj.get("verdict") not in (
                "supported",
                "contradicted",
                "not_found",
            ):
                claim_details.append({"claim": claim, "status": "error", "reason": "invalid JSON"})
                n_error += 1
                explanation_lines.append(f"- {claim}: error (invalid JSON)")
                continue
            _CLAIM_JUDGE_CACHE[cache_key] = verdict_obj

        verdict = str(verdict_obj["verdict"])
        detail = {
            "claim": claim,
            "status": "completed",
            "verdict": verdict,
            "evidence_box": verdict_obj.get("evidence_box"),
            "evidence_time_ms": verdict_obj.get("evidence_time_ms"),
            "explanation": verdict_obj.get("explanation"),
        }
        claim_details.append(detail)
        explanation_lines.append(f"- {claim}: {verdict}")
        if verdict == "supported":
            n_supported += 1
            rec: dict[str, Any] = {
                "type": "claim",
                "role": "supports",
                "locator": claim,
                "judge_claimed": True,
            }
            if verdict_obj.get("evidence_box"):
                rec["evidence_box"] = verdict_obj["evidence_box"]
            if verdict_obj.get("evidence_time_ms"):
                rec["evidence_time_ms"] = verdict_obj["evidence_time_ms"]
            evidence.append(rec)
        elif verdict == "contradicted":
            n_contradicted += 1
        else:
            n_not_found += 1

    judged_n = n_supported + n_contradicted + n_not_found
    if judged_n == 0:
        groundedness = 0.0
        hallucination = 1.0
    else:
        groundedness = n_supported / judged_n
        hallucination = (n_contradicted + n_not_found) / judged_n

    completeness = None
    completeness_skipped = False
    completeness_reason = None
    facts = None
    # Prefer metadata.expectation.facts on case or trace
    meta_src = None
    if case and isinstance(case.get("metadata"), dict):
        meta_src = case["metadata"]
    if trace and isinstance(trace.get("metadata"), dict):
        meta_src = trace["metadata"]
    exp = None
    if meta_src and isinstance(meta_src.get("expectation"), dict):
        exp = meta_src["expectation"]
    if case and isinstance(case.get("expectation"), dict):
        exp = case["expectation"]
    if exp and isinstance(exp.get("facts"), list):
        facts = [str(f) for f in exp["facts"] if str(f).strip()]
    if facts is None and isinstance((case or {}).get("facts"), list):
        facts = [str(f) for f in case["facts"] if str(f).strip()]

    if not facts:
        completeness_skipped = True
        completeness_reason = "no reference facts"
    elif calls_used < CLAIM_GROUNDING_MAX_CALLS:
        facts_prompt = (
            "Given the agent output and the reference facts, estimate what fraction of the "
            "reference facts are covered (0-1). Reply JSON: "
            '{"completeness": <float>, "explanation": "..."}.\n\n'
            f"OUTPUT:\n{text}\n\nFACTS:\n" + "\n".join(f"- {f}" for f in facts)
        )
        raw_c, _, cerr = _invoke_claim_judge(
            judge_fn, facts_prompt, images=images, model=model, timeout_s=CLAIM_GROUNDING_TIMEOUT_S
        )
        calls_used += 1
        if cerr:
            completeness_skipped = True
            completeness_reason = cerr
        else:
            cobj = _parse_json_obj(raw_c or "")
            if cobj and cobj.get("completeness") is not None:
                try:
                    completeness = float(cobj["completeness"])
                    completeness = max(0.0, min(1.0, completeness))
                except (TypeError, ValueError):
                    completeness_skipped = True
                    completeness_reason = "invalid completeness JSON"
            else:
                completeness_skipped = True
                completeness_reason = "invalid completeness JSON"
    else:
        completeness_skipped = True
        completeness_reason = "max judge calls"

    if groundedness >= 0.9:
        label = "grounded"
    elif groundedness < 0.5:
        label = "hallucinated"
    else:
        label = "partially_grounded"

    res = _result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=groundedness,
        verdict="pass" if groundedness >= 0.9 else "fail",
        label=label,
        explanation="\n".join(explanation_lines),
        evidence=evidence,
    )
    res["execution_metadata"].update(
        {
            "judge_model": model,
            "calls": calls_used,
            "claims": claim_details,
            "groundedness": groundedness,
            "hallucination": hallucination,
            "completeness": completeness,
            "completeness_skipped": completeness_skipped,
            "completeness_reason": completeness_reason,
            "n_supported": n_supported,
            "n_contradicted": n_contradicted,
            "n_not_found": n_not_found,
            "n_error": n_error,
            "media_sha256": media_sha,
            "modality": modality,
        }
    )
    return res


# --------------------------------------------------------------------------- orchestration


def case_has_reference(case: dict) -> bool:
    return bool(
        case.get("truth_box")
        or case.get("truth_span")
        or case.get("truth_span_ms")
        or case.get("answer") is not None
    )


def select_evaluators_for_case(case: dict) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Pick evaluators whose modalities match and whose reference needs are met."""
    modality = case.get("modality", "image")
    has_ref = case_has_reference(case)
    selected, skipped = [], []
    for meta in REGISTRY.values():
        if modality not in meta["modalities"]:
            skipped.append((meta, f"modality '{modality}' not in {meta['modalities']}"))
        elif meta["needs_reference"] and not has_ref:
            skipped.append((meta, "needs_reference but case has no expectation"))
        else:
            selected.append(meta)
    return selected, skipped


def evaluate_all(
    cases,
    runs,
    judged,
    agents,
    evidence_margin: float = DEFAULT_EVIDENCE_MARGIN,
    judge_model: str | None = None,
):
    """Run all registered evaluators over stored runs. Never calls a model."""
    by_id = {c["id"]: c for c in cases}
    indexed = _run_index(runs)
    results: list[dict] = []
    by_target_eval: dict[tuple, dict] = {}
    margin = float(evidence_margin)

    run_metas = [REGISTRY[k] for k in REGISTRY if REGISTRY[k]["scope"] == "run"]
    # Dependency order: no deps first
    run_metas = sorted(run_metas, key=lambda m: len(m["depends_on"]))

    for run in runs:
        variant = _variant(run)
        if variant in ("blind", "blind_guess"):
            continue
        case = by_id.get(run["case_id"])
        if case is None:
            continue
        agent, case_id = run["agent"], run["case_id"]
        selected, skipped_sel = select_evaluators_for_case(case)
        selected_ids = {m["id"] for m in selected}
        skip_reasons = {m["id"]: reason for m, reason in skipped_sel}
        produced = {}
        for meta in run_metas:
            if meta["id"] not in selected_ids:
                res = _skipped(
                    agent,
                    case_id,
                    variant,
                    meta,
                    skip_reasons.get(meta["id"], "evaluator not selected for case"),
                )
                results.append(res)
                produced[meta["id"]] = res
                by_target_eval[(agent, case_id, variant, meta["id"])] = res
                continue
            dep_fail = None
            for dep in meta["depends_on"]:
                prior = produced.get(dep) or by_target_eval.get((agent, case_id, variant, dep))
                if prior is None or prior.get("status") != "completed":
                    dep_fail = dep
                    break
            if dep_fail:
                res = _skipped(
                    agent,
                    case_id,
                    variant,
                    meta,
                    f"dependency not completed: {dep_fail}",
                )
            else:
                res = _call(
                    meta,
                    agent,
                    case_id,
                    variant,
                    case=case,
                    run=run,
                    judged=judged,
                    evidence_margin=margin,
                    judge_model=judge_model,
                )
            results.append(res)
            produced[meta["id"]] = res
            by_target_eval[(agent, case_id, variant, meta["id"])] = res
            if meta["id"] == "claim_grounding":
                for sib in _expand_claim_grounding_siblings(res, agent, case_id, variant):
                    results.append(sib)

    pair_metas = [REGISTRY[k] for k in REGISTRY if REGISTRY[k]["scope"] == "pair"]
    case_ids = sorted({r["case_id"] for r in runs})
    for agent in agents:
        for case_id in case_ids:
            case = by_id.get(case_id)
            if case is None:
                continue
            selected, skipped_sel = select_evaluators_for_case(case)
            selected_ids = {m["id"] for m in selected}
            skip_reasons = {m["id"]: reason for m, reason in skipped_sel}
            siblings = {
                v: indexed.get((agent, case_id, v))
                for v in ("clean", "blur", "noise", "lowres", "bandlimit", "blind", "blind_guess")
            }
            for meta in pair_metas:
                if meta["id"] not in selected_ids:
                    res = _skipped(
                        agent,
                        case_id,
                        "all",
                        meta,
                        skip_reasons.get(meta["id"], "evaluator not selected for case"),
                    )
                else:
                    res = _call(
                        meta,
                        agent,
                        case_id,
                        "all",
                        case=case,
                        clean_run=siblings.get("clean"),
                        blind_run=siblings.get("blind"),
                        blind_guess_run=siblings.get("blind_guess"),
                        sibling_runs=siblings,
                        judged=judged,
                        evidence_margin=margin,
                        judge_model=judge_model,
                    )
                results.append(res)
                by_target_eval[(agent, case_id, "all", meta["id"])] = res

    # Suite evaluators: selected if any case in the suite can use them.
    suite_modalities = {c.get("modality", "image") for c in cases}
    for meta in (REGISTRY[k] for k in REGISTRY if REGISTRY[k]["scope"] == "suite"):
        if not (suite_modalities & set(meta["modalities"])):
            res = _skipped(
                "*",
                "*",
                "all",
                meta,
                f"suite modalities {sorted(suite_modalities)} not in {meta['modalities']}",
            )
        else:
            res = _call(
                meta,
                "*",
                "*",
                "all",
                case=None,
                run=None,
                judged=judged or [],
                evidence_margin=margin,
                judge_model=judge_model,
            )
        results.append(res)

    dimension_summary = _dimension_summary(results)
    dimension_summary.extend(_confident_error_rows(cases, runs, agents, margin=margin))
    disagreements = _disagreements(judged or [], by_target_eval)
    conflicts = detect_conflicts(results, disagreements)
    return results, dimension_summary, disagreements, conflicts


def detect_conflicts(results: list[dict], disagreements: list[dict] | None = None) -> list[dict]:
    """Flag judge/deterministic disagreements and pass/fail clashes on the same target."""
    conflicts = list(disagreements or [])
    by_target: dict[tuple, dict[str, dict]] = defaultdict(dict)
    for r in results:
        if r.get("status") != "completed":
            continue
        t = r["target"]
        by_target[(t["agent"], t["case_id"], t["variant"])][r["evaluator_id"]] = r
    for key, by_eid in by_target.items():
        eg = by_eid.get("evidence_grounding")
        pj = by_eid.get("perception_judge")
        if (
            eg
            and pj
            and eg.get("verdict") == "fail"
            and pj.get("verdict") == "pass"
        ):
            conflicts.append(
                {
                    "kind": "perception_judge_vs_grounding",
                    "agent": key[0],
                    "case_id": key[1],
                    "variant": key[2],
                    "perception_judge_id": pj["id"],
                    "evidence_grounding_id": eg["id"],
                }
            )
        ac = by_eid.get("answer_correctness")
        sa = by_eid.get("stage_attribution")
        if ac and sa and ac.get("verdict") == "pass" and sa.get("label") == "correct_ungrounded":
            conflicts.append(
                {
                    "kind": "correct_but_ungrounded",
                    "agent": key[0],
                    "case_id": key[1],
                    "variant": key[2],
                    "answer_correctness_id": ac["id"],
                    "stage_attribution_id": sa["id"],
                }
            )
    return conflicts


def _confident_error_rows(cases, runs, agents, margin: float = 0) -> list[dict]:
    """Share of runs whose answer is wrong and not an abstention, per agent × variant."""
    by_id = {c["id"]: c for c in cases}
    variants = sorted({_variant(r) for r in runs})
    rows = []
    for agent in agents:
        for variant in variants:
            rs = [r for r in runs if r["agent"] == agent and _variant(r) == variant]
            if not rs:
                continue
            n_err = 0
            labels = Counter()
            for r in rs:
                case = by_id.get(r["case_id"])
                if case is None:
                    continue
                label = _stage_label(case, run=r, margin=margin)
                correct = core.answer_correct(case, r.get("answer")) if _is_valid(r) else False
                if _is_valid(r) and not correct and label != "abstained":
                    n_err += 1
                    labels["confident_error"] += 1
                else:
                    labels[label] += 1
            n = len(rs)
            rows.append(
                {
                    "agent": agent,
                    "variant": variant,
                    "dimension": "Confident errors",
                    "evaluator_id": "confident_errors",
                    "n": n,
                    "mean_score": (n_err / n) if n else None,
                    "labels": dict(labels),
                    "skipped": 0,
                    "errors": 0,
                }
            )
    return rows


def relabel_runs(cases, runs, margin: float = DEFAULT_EVIDENCE_MARGIN) -> None:
    """Refresh run label / correct / evidence_ok from answer+box (no model calls)."""
    by_id = {c["id"]: c for c in cases}
    for run in runs:
        case = by_id.get(run["case_id"])
        if case is None:
            continue
        correct, ev_ok, valid = _recompute(case, run, margin=margin)
        run["correct"] = correct
        run["evidence_ok"] = ev_ok
        run["label"] = _stage_label(case, run, margin=margin)
        truth = case.get("truth_box")
        if run.get("box") and truth:
            run["iou"] = round(core.iou(truth, run["box"]), 3)


def _dimension_summary(results: list[dict]) -> list[dict]:
    groups: dict[tuple, list] = defaultdict(list)
    for r in results:
        t = r["target"]
        key = (t["agent"], t["variant"], r["dimension"], r["evaluator_id"])
        groups[key].append(r)
    rows = []
    for (agent, variant, dimension, eid), items in sorted(groups.items()):
        completed = [x for x in items if x["status"] == "completed"]
        scores = [x["score"] for x in completed if x["score"] is not None]
        labels = dict(Counter(x.get("label") for x in completed if x.get("label")))
        rows.append(
            {
                "agent": agent,
                "variant": variant,
                "dimension": dimension,
                "evaluator_id": eid,
                "n": len(completed),
                "mean_score": (sum(scores) / len(scores)) if scores else None,
                "labels": labels,
                "skipped": sum(1 for x in items if x["status"] == "skipped"),
                "errors": sum(1 for x in items if x["status"] == "error"),
            }
        )
    return rows


def _disagreements(judged: list[dict], by_target_eval: dict) -> list[dict]:
    out = []
    for j in judged:
        if j.get("kind") != "agent_answer":
            continue
        if j.get("judge_accepts") is None:
            continue
        if j["judge_accepts"] != j.get("truth_correct"):
            out.append(
                {
                    "kind": "judge_vs_truth",
                    "agent": j.get("agent"),
                    "case_id": j.get("case_id"),
                    "variant": "clean",
                    "judge_accepts": j["judge_accepts"],
                    "truth_correct": j.get("truth_correct"),
                    "proposed": j.get("proposed"),
                }
            )
        if j["judge_accepts"] is True:
            eg = by_target_eval.get((j.get("agent"), j.get("case_id"), "clean", "evidence_grounding"))
            if eg is not None and eg.get("status") == "completed" and eg.get("verdict") == "fail":
                out.append(
                    {
                        "kind": "judge_vs_grounding",
                        "agent": j.get("agent"),
                        "case_id": j.get("case_id"),
                        "variant": "clean",
                        "judge_accepts": True,
                        "evidence_grounding_id": eg["id"],
                        "proposed": j.get("proposed"),
                    }
                )
    return out


# --------------------------------------------------------------------------- traces

AUDIO_TURN_COUNT = 5


def _asset_for(case_id: str, variant: str) -> dict | None:
    if variant == "blind":
        return None
    path = OUT / "perturbed" / f"{case_id}_{variant}.png"
    rel = f"out/perturbed/{case_id}_{variant}.png"
    transform = VARIANT_TRANSFORM.get(variant, variant)
    if path.exists():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    else:
        digest = hashlib.sha256(rel.encode()).hexdigest()[:12]
    return {
        "id": digest,
        "path": rel,
        "modality": "image",
        "transformation": transform,
    }


def _audio_asset_for(case: dict | None, variant: str) -> dict | None:
    if case is None or variant in ("blind", "blind_guess"):
        return None
    rel = case.get("audio")
    if not rel:
        return None
    path = ROOT / rel
    if path.is_file():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    else:
        digest = hashlib.sha256(str(rel).encode()).hexdigest()[:12]
    return {
        "id": digest,
        "path": rel,
        "modality": "audio",
        "transformation": variant,
    }


def _missing_note(value, fallback="(not recorded in this run)"):
    if value is None or value == "":
        return fallback
    return value


def _is_audio_run(case: dict | None, run: dict) -> bool:
    if case and case.get("modality") == "video":
        return False
    if case and case.get("modality") == "audio":
        return True
    if run.get("asr_turns") is not None:
        return True
    if run.get("transcript") is not None and run.get("turn_wers") is not None:
        return True
    # Legacy audio rows may only carry span_ms (not used by image runs).
    if run.get("span_ms") is not None and not run.get("box") and case is None:
        return True
    return False


def _result_id_index(results) -> tuple[dict, dict, list]:
    run_results: dict[tuple, list[str]] = defaultdict(list)
    pair_results: dict[tuple, list[str]] = defaultdict(list)
    suite_ids: list[str] = []
    for r in results:
        t = r["target"]
        if t["agent"] == "*" and t["case_id"] == "*":
            suite_ids.append(r["id"])
        elif t["variant"] == "all":
            pair_results[(t["agent"], t["case_id"])].append(r["id"])
        else:
            run_results[(t["agent"], t["case_id"], t["variant"])].append(r["id"])
    return run_results, pair_results, suite_ids


def _collect_result_ids(agent, case_id, variant, run_results, pair_results, suite_ids) -> list[str]:
    ids = list(run_results.get((agent, case_id, variant), []))
    ids.extend(pair_results.get((agent, case_id), []))
    ids.extend(suite_ids)
    return ids


def _turn_detail_map(run: dict) -> dict[str, dict]:
    """Map turn index -> {latency, wer, ...} from stored per-turn fields."""
    out: dict[str, dict] = {}
    for d in run.get("asr_details") or []:
        if isinstance(d, dict) and d.get("index") is not None:
            out[str(d["index"])] = d
    latencies = run.get("turn_latencies") or {}
    if isinstance(latencies, dict):
        for k, v in latencies.items():
            out.setdefault(str(k), {})["latency"] = v
    return out


def build_audio_trace(case: dict | None, run: dict, result_ids: list[str] | None = None) -> dict:
    """Fan-out / fan-in audio DAG: attach -> 5 parallel ASR turns -> model -> evaluation."""
    agent = run.get("agent") or "agent"
    case_id = run.get("case_id") or (case or {}).get("id") or "case"
    variant = _variant(run)
    transform = VARIANT_TRANSFORM.get(variant, variant)
    asset = _audio_asset_for(case, variant)
    assets = [asset] if asset else []

    attach_name = "attach_audio" if variant not in ("blind", "blind_guess") else "remove_media"
    s1 = {
        "id": "s1",
        "name": attach_name,
        "type": "media",
        "status": "completed",
        "parent_span_ids": [],
        "metadata": {
            "asset_id": assets[0]["id"] if assets else None,
            "transformation": transform if attach_name == "attach_audio" else "remove_media",
        },
    }

    turns_by_idx = {str(t.get("index")): t for t in ((case or {}).get("turns") or []) if isinstance(t, dict)}
    asr_turns = {str(k): v for k, v in (run.get("asr_turns") or {}).items()}
    turn_wers = {str(k): v for k, v in (run.get("turn_wers") or {}).items()}
    details = _turn_detail_map(run)

    s2_ids: list[str] = []
    s2_spans: list[dict] = []
    for k in range(1, AUDIO_TURN_COUNT + 1):
        sid = f"s2_{k}"
        s2_ids.append(sid)
        tmeta = turns_by_idx.get(str(k), {})
        detail = details.get(str(k), {})
        text = asr_turns.get(str(k))
        wer_v = turn_wers.get(str(k))
        if wer_v is None:
            wer_v = detail.get("wer")
        latency = detail.get("latency")
        attrs = {
            "turn": k,
            "start_ms": tmeta.get("start_ms") if tmeta else None,
            "end_ms": tmeta.get("end_ms") if tmeta else None,
            "asr_latency_s": latency if latency is not None else None,
            "wer": wer_v if wer_v is not None else None,
            "text": text if text is not None else None,
        }
        span = {
            "id": sid,
            "name": f"transcribe turn {k}",
            "type": "media",
            "status": "completed",
            "parent_span_ids": ["s1"],
            "attributes": attrs,
        }
        if latency is not None:
            span["latency_s"] = latency
        s2_spans.append(span)

    prompt = run.get("prompt")
    raw = run.get("raw")
    usage = run.get("usage")
    model = run.get("model") or agent
    if prompt is None:
        if case is not None and case.get("question"):
            prompt = core.audio_agent_prompt(case["question"], run.get("transcript") or "", variant)
        else:
            prompt = "(not recorded in this run)"
    if raw is None:
        raw = "(not recorded in this run)"
    if usage is None:
        usage = "(not recorded in this run)"

    status = "failed" if run.get("error") else "completed"
    s3 = {
        "id": "s3",
        "name": "model_call",
        "type": "model",
        "status": status,
        "parent_span_ids": list(s2_ids),
        "model": model,
        "latency_s": run.get("latency"),
        "usage": usage,
        "input": {"prompt": prompt},
        "output": {
            "raw": raw,
            "answer": run.get("answer"),
            "span_ms": run.get("span_ms"),
        },
        "error": run.get("error"),
    }
    s4 = {
        "id": "s4",
        "name": "evaluation",
        "type": "evaluation",
        "status": "completed",
        "parent_span_ids": ["s3"],
        "result_ids": list(result_ids or []),
    }
    return {
        "id": f"{agent}|{case_id}|{variant}",
        "agent": agent,
        "case_id": case_id,
        "variant": variant,
        "variant_transform": transform,
        "assets": assets,
        "spans": [s1, *s2_spans, s3, s4],
    }


def dag_is_acyclic(spans: list[dict]) -> bool:
    """Return True when parent_span_ids form a DAG (no cycles)."""
    children: dict[str, list[str]] = defaultdict(list)
    ids = {s.get("id") for s in spans if s.get("id")}
    for s in spans:
        sid = s.get("id")
        if not sid:
            continue
        for p in s.get("parent_span_ids") or s.get("parent_ids") or []:
            if p in ids:
                children[p].append(sid)
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node: str) -> bool:
        if node in done:
            return True
        if node in visiting:
            return False
        visiting.add(node)
        for nxt in children.get(node, []):
            if not visit(nxt):
                return False
        visiting.remove(node)
        done.add(node)
        return True

    return all(visit(n) for n in ids)


def build_traces(cases, runs, results) -> list[dict]:
    """One trace per run. Image: media->model->eval. Audio: fan-out ASR -> join model -> eval."""
    by_id = {c["id"]: c for c in cases}
    run_results, pair_results, suite_ids = _result_id_index(results)

    traces = []
    for run in runs:
        agent, case_id, variant = run["agent"], run["case_id"], _variant(run)
        case = by_id.get(case_id)
        result_ids = _collect_result_ids(agent, case_id, variant, run_results, pair_results, suite_ids)
        if _is_audio_run(case, run):
            traces.append(build_audio_trace(case, run, result_ids))
            continue

        transform = VARIANT_TRANSFORM.get(variant, variant)
        asset = _asset_for(case_id, variant)
        assets = [asset] if asset else []

        prompt = run.get("prompt")
        raw = run.get("raw")
        usage = run.get("usage")
        model = run.get("model") or agent
        if prompt is None:
            if case is not None:
                prompt = core.AGENT_PROMPT.format(question=case["question"])
            else:
                prompt = "(not recorded in this run)"
        if raw is None:
            raw = "(not recorded in this run)"
        if usage is None:
            usage = "(not recorded in this run)"

        if variant == "blind":
            s1 = {
                "id": "s1",
                "name": "remove_media",
                "type": "media",
                "status": "completed",
                "parent_span_ids": [],
                "metadata": {"transformation": "remove_media"},
            }
        else:
            s1 = {
                "id": "s1",
                "name": "attach_image",
                "type": "media",
                "status": "completed",
                "parent_span_ids": [],
                "metadata": {
                    "asset_id": assets[0]["id"] if assets else None,
                    "transformation": transform,
                },
            }

        status = "failed" if run.get("error") else "completed"
        s2 = {
            "id": "s2",
            "name": "model_call",
            "type": "model",
            "status": status,
            "parent_span_ids": ["s1"],
            "model": model,
            "latency_s": run.get("latency"),
            "usage": usage,
            "input": {"prompt": prompt},
            "output": {"raw": raw, "answer": run.get("answer"), "box": run.get("box")},
            "error": run.get("error"),
        }

        s3 = {
            "id": "s3",
            "name": "evaluation",
            "type": "evaluation",
            "status": "completed",
            "parent_span_ids": ["s2"],
            "result_ids": result_ids,
        }

        traces.append(
            {
                "id": f"{agent}|{case_id}|{variant}",
                "agent": agent,
                "case_id": case_id,
                "variant": variant,
                "variant_transform": transform,
                "assets": assets,
                "spans": [s1, s2, s3],
            }
        )
    return traces


def write_traces(traces: list[dict], traces_dir: Path | None = None) -> None:
    traces_dir = traces_dir or (OUT / "traces")
    traces_dir.mkdir(parents=True, exist_ok=True)
    import json

    for tr in traces:
        name = tr["id"].replace("|", "__") + ".json"
        (traces_dir / name).write_text(json.dumps(tr, indent=1))


def _refresh_video_traces(old_traces: list[dict], cases, runs, results) -> list[dict]:
    """Keep the fan-out sample-frame DAG; refresh evaluation result_ids only."""
    by_id = {c["id"]: c for c in cases}
    run_results, pair_results, suite_ids = _result_id_index(results)
    old_by_id = {t.get("id"): t for t in old_traces if t.get("id")}
    out = []
    for run in runs:
        agent, case_id, variant = run["agent"], run["case_id"], _variant(run)
        tid = f"{agent}|{case_id}|{variant}"
        result_ids = _collect_result_ids(agent, case_id, variant, run_results, pair_results, suite_ids)
        prev = old_by_id.get(tid)
        if prev and any(str(s.get("name", "")).startswith("sample frame") for s in (prev.get("spans") or [])):
            spans = []
            for sp in prev.get("spans") or []:
                sp = dict(sp)
                if sp.get("name") == "evaluation" or sp.get("type") == "evaluation":
                    sp["result_ids"] = list(result_ids)
                spans.append(sp)
            tr = dict(prev)
            tr["spans"] = spans
            out.append(tr)
            continue
        # Fallback: rebuild with frame timestamps recovered from prior spans or empty.
        frame_tmss = []
        if prev:
            for sp in prev.get("spans") or []:
                attrs = sp.get("attributes") or {}
                if attrs.get("t_ms") is not None:
                    frame_tmss.append(int(attrs["t_ms"]))
        from .video_run import build_video_trace

        out.append(build_video_trace(by_id[case_id], run, frame_tmss, result_ids))
    return out


def enrich_results_payload(data: dict, evidence_margin: float = DEFAULT_EVIDENCE_MARGIN) -> dict:
    """Recompute results / summary / disagreements / registry / traces from stored runs."""
    margin = float(evidence_margin)
    preserved_manifest = (data.get("meta") or {}).get("manifest")
    data.setdefault("meta", {})["evidence_margin"] = margin
    agents = list(data.get("meta", {}).get("agents") or sorted({r["agent"] for r in data["runs"]}))
    judge_model = data.get("meta", {}).get("judge")
    relabel_runs(data["cases"], data["runs"], margin=margin)
    results, dimension_summary, disagreements, conflicts = evaluate_all(
        data["cases"],
        data["runs"],
        data.get("judged") or [],
        agents,
        evidence_margin=margin,
        judge_model=judge_model,
    )
    is_video = (data.get("meta") or {}).get("modality") == "video" or any(
        (c or {}).get("modality") == "video" for c in (data.get("cases") or [])
    )
    if is_video:
        traces = _refresh_video_traces(data.get("traces") or [], data["cases"], data["runs"], results)
    else:
        traces = build_traces(data["cases"], data["runs"], results)
    data["results"] = results
    data["dimension_summary"] = dimension_summary
    data["disagreements"] = disagreements
    data["conflicts"] = conflicts
    data["registry"] = registry_list()
    data["traces"] = traces
    from .events import attach_events_to_traces

    attach_events_to_traces(data)
    if preserved_manifest is not None:
        data["meta"]["manifest"] = preserved_manifest
    # Keep any existing plan statuses; do not invent jobs during rescore.
    data.setdefault("plan", data.get("plan") or [])
    return data


# Register video evaluators into REGISTRY without a circular import at module load of video_evaluators alone.
def _ensure_video_evaluators_registered() -> None:
    try:
        from . import video_evaluators as _video_evaluators  # noqa: F401
    except Exception:
        pass


_ensure_video_evaluators_registered()
