"""Video-specific evaluators registered via the existing @evaluator decorator.

Importing this module adds entries to evalverse.evaluators.REGISTRY without
editing evaluators.py.
"""
from __future__ import annotations

from evalverse import evaluators as ev
from evalverse import video as vmod


@ev.evaluator(
    id="temporal_alignment_video",
    version="1.0.0",
    category="deterministic",
    dimension="Temporal grounding",
    modalities=["video"],
    needs_reference=True,
    scope="run",
)
def temporal_alignment_video(*, agent, case_id, variant, meta, case, run, **_):
    if case.get("modality") != "video":
        return ev._skipped(agent, case_id, variant, meta, "video only")
    truth = case.get("truth_span_ms")
    claimed = run.get("span_ms")
    interval = vmod.sampling_interval_ms(variant)
    if not truth:
        return ev._skipped(agent, case_id, variant, meta, "no truth_span_ms")
    ok = vmod.video_span_match(truth, claimed, sampling_interval_ms=interval)
    is_point = (
        isinstance(claimed, (list, tuple))
        and len(claimed) == 2
        and claimed[0] == claimed[1]
    )
    if is_point:
        explanation = (
            f"Point estimate {claimed[0]} vs truth {truth} "
            f"(sample interval {interval} ms)."
        )
    else:
        explanation = (
            f"Cited span {claimed} vs truth {truth} (sample interval {interval} ms)."
        )
    return ev._result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=1.0 if ok else 0.0,
        verdict="pass" if ok else "fail",
        label="aligned" if ok else "misaligned",
        explanation=explanation,
        evidence=[
            {"type": "time_span", "role": "expected", "locator": list(truth)},
            {"type": "time_span", "role": "claimed", "locator": list(claimed) if claimed else None},
        ],
    )


@ev.evaluator(
    id="event_order",
    version="1.0.0",
    category="deterministic",
    dimension="Reasoning",
    modalities=["video"],
    needs_reference=True,
    scope="run",
)
def event_order(*, agent, case_id, variant, meta, case, run, **_):
    if case.get("modality") != "video":
        return ev._skipped(agent, case_id, variant, meta, "video only")
    if not str(case_id).endswith("_order") and not str(case.get("id", "")).endswith("_order"):
        return ev._skipped(agent, case_id, variant, meta, "event_order only for *_order cases")
    correct = vmod.video_answer_correct(case, run.get("answer"))
    return ev._result(
        agent=agent,
        case_id=case_id,
        variant=variant,
        meta=meta,
        status="completed",
        score=1.0 if correct else 0.0,
        verdict="pass" if correct else "fail",
        label="ordered" if correct else "wrong_order",
        explanation=(
            f"Predicted {run.get('answer')!r}; expected {case.get('answer')!r}."
        ),
    )
