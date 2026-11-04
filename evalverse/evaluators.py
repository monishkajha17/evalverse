"""Release 0.1 evaluator registry: side-effect-free checks over stored runs.

Evaluators never call a model or re-run an agent. Variants that need a second
pass (blind, blur, …) are produced by the orchestrator in run.py; paired
evaluators only read sibling results.
"""
from __future__ import annotations

import hashlib
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
    modalities=["image"],
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


@evaluator(
    id="stage_attribution",
    version="1.0.0",
    category="composite",
    dimension="Failure analysis",
    modalities=["image"],
    needs_reference=True,
    depends_on=("answer_correctness",),
    scope="run",
)
def stage_attribution(*, agent, case_id, variant, meta, case, run, evidence_margin=DEFAULT_EVIDENCE_MARGIN, **_):
    label = _stage_label(case, run, margin=evidence_margin)
    pass_labels = {"grounded_correct", "complete_correct", "abstained_correctly"}
    score = 1.0 if label in pass_labels else 0.0
    evidence = []
    if case.get("truth_box"):
        evidence.append({"type": "image_region", "role": "expected", "locator": list(case["truth_box"])})
    if run.get("box"):
        evidence.append({"type": "image_region", "role": "claimed", "locator": list(run["box"])})
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
    modalities=["image", "audio"],
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
    modalities=["audio"],
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
    modalities=["image", "audio"],
    needs_reference=True,
    needs_replay=True,
    scope="pair",
)
def robustness_sweep(*, agent, case_id, variant, meta, case, sibling_runs, evidence_margin=DEFAULT_EVIDENCE_MARGIN, **_):
    order = ("noise", "bandlimit") if case.get("modality") == "audio" else ROBUSTNESS_ORDER
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
    modalities=["image"],
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
    modalities=["image", "audio"],
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


# --------------------------------------------------------------------------- orchestration


def case_has_reference(case: dict) -> bool:
    return bool(
        case.get("truth_box")
        or case.get("truth_span")
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


def _missing_note(value, fallback="(not recorded in this run)"):
    if value is None or value == "":
        return fallback
    return value


def build_traces(cases, runs, results) -> list[dict]:
    """One trace per run, with media -> model -> evaluation spans."""
    by_id = {c["id"]: c for c in cases}
    # Index results for attachment
    run_results: dict[tuple, list[str]] = defaultdict(list)
    pair_results: dict[tuple, list[str]] = defaultdict(list)
    suite_ids = []
    for r in results:
        t = r["target"]
        if t["agent"] == "*" and t["case_id"] == "*":
            suite_ids.append(r["id"])
        elif t["variant"] == "all":
            pair_results[(t["agent"], t["case_id"])].append(r["id"])
        else:
            run_results[(t["agent"], t["case_id"], t["variant"])].append(r["id"])

    traces = []
    for run in runs:
        agent, case_id, variant = run["agent"], run["case_id"], _variant(run)
        transform = VARIANT_TRANSFORM.get(variant, variant)
        asset = _asset_for(case_id, variant)
        assets = [asset] if asset else []

        prompt = run.get("prompt")
        raw = run.get("raw")
        usage = run.get("usage")
        model = run.get("model") or agent
        if prompt is None:
            case = by_id.get(case_id)
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

        result_ids = list(run_results.get((agent, case_id, variant), []))
        result_ids.extend(pair_results.get((agent, case_id), []))
        result_ids.extend(suite_ids)
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
    traces = build_traces(data["cases"], data["runs"], results)
    data["results"] = results
    data["dimension_summary"] = dimension_summary
    data["disagreements"] = disagreements
    data["conflicts"] = conflicts
    data["registry"] = registry_list()
    data["traces"] = traces
    if preserved_manifest is not None:
        data["meta"]["manifest"] = preserved_manifest
    # Keep any existing plan statuses; do not invent jobs during rescore.
    data.setdefault("plan", data.get("plan") or [])
    return data
