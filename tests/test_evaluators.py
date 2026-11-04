"""Unit tests for Release 0.1 image evaluators."""
from __future__ import annotations

import json

import pytest

from evalverse import core
from evalverse import evaluators as ev

CASE = {
    "id": "t1",
    "question": "What is the total?",
    "answer": "42.00",
    "answer_type": "number",
    "distractor": "12.00",
    "truth_box": [100, 200, 300, 250],
    "image": "data/images/t1.png",
}


def _run(answer, box, *, agent="a", case_id="t1", condition="clean", label=None, error=None, evidence="seen"):
    if label == "invalid_output" or error:
        correct, ev_ok, lab = False, False, "invalid_output"
        evidence = ""
    else:
        correct = core.answer_correct(CASE, answer)
        ev_ok = core.evidence_ok(CASE["truth_box"], box)
        lab = label or core.attribute(correct, ev_ok, True, answer=answer, box=box)
    return {
        "agent": agent,
        "case_id": case_id,
        "condition": condition,
        "answer": answer,
        "box": box,
        "evidence": evidence,
        "correct": correct,
        "evidence_ok": ev_ok,
        "iou": round(core.iou(CASE["truth_box"], box), 3) if box else 0.0,
        "label": lab,
        "latency": 0.01,
        "error": error,
        "model": agent,
        "prompt": "p",
        "raw": "{}",
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def _stage(answer, box, **kwargs):
    run = _run(answer, box, **kwargs)
    return ev._call(
        ev.REGISTRY["stage_attribution"],
        "a",
        "t1",
        "clean",
        case=CASE,
        run=run,
        evidence_margin=0,
    )


def test_stage_labels_including_abstained():
    truth = CASE["truth_box"]
    assert _stage("42.00", truth)["label"] == "grounded_correct"
    assert _stage("42.00", [0, 0, 50, 50])["label"] == "correct_ungrounded"
    assert _stage("12.00", truth)["label"] == "misread"
    assert _stage("12.00", [0, 0, 50, 50])["label"] == "mislocated"
    assert _stage("unknown", None)["label"] == "abstained"
    assert _stage("", None)["label"] == "abstained"
    assert core.attribute(False, False, False, answer="unknown", box=None) == "invalid_output"


def test_evidence_ok_margin():
    truth = [100, 200, 300, 220]
    # Box just below the truth row — fails strict, passes with vertical margin.
    near = [100, 230, 300, 260]
    assert core.evidence_ok(truth, near, margin=0) is False
    assert core.evidence_ok(truth, near, margin=25) is True


def test_media_dependence_cases():
    meta = ev.REGISTRY["media_dependence"]
    clean_right = _run("42.00", CASE["truth_box"], condition="clean")
    blind_wrong = _run("unknown", None, condition="blind")
    blind_right = _run("42.00", None, condition="blind")
    clean_wrong = _run("12.00", CASE["truth_box"], condition="clean")

    both = ev._call(
        meta, "a", "t1", "all", case=CASE, clean_run=clean_right, blind_run=blind_right, sibling_runs={}
    )
    assert both["status"] == "completed"
    assert both["label"] == "media_not_required"
    assert both["verdict"] == "fail"
    assert both["score"] == 0.0

    needed = ev._call(
        meta, "a", "t1", "all", case=CASE, clean_run=clean_right, blind_run=blind_wrong, sibling_runs={}
    )
    assert needed["label"] == "media_required"
    assert needed["verdict"] == "pass"
    assert needed["score"] == 1.0

    incon = ev._call(
        meta, "a", "t1", "all", case=CASE, clean_run=clean_wrong, blind_run=blind_wrong, sibling_runs={}
    )
    assert incon["status"] == "inconclusive"
    assert incon["score"] is None

    missing = ev._call(
        meta, "a", "t1", "all", case=CASE, clean_run=clean_right, blind_run=None, sibling_runs={}
    )
    assert missing["status"] == "skipped"
    assert missing["score"] is None


def test_raising_evaluator_becomes_error():
    @ev.evaluator(
        id="_test_boom",
        version="0.0.1",
        category="deterministic",
        dimension="Test",
        modalities=["image"],
        needs_reference=False,
        scope="run",
    )
    def boom(**_kwargs):
        raise RuntimeError("intentional boom")

    try:
        res = ev._call(
            ev.REGISTRY["_test_boom"],
            "a",
            "t1",
            "clean",
            case=CASE,
            run=_run("42.00", CASE["truth_box"]),
        )
        assert res["status"] == "error"
        assert res["score"] is None
        assert "intentional boom" in res["explanation"]
    finally:
        del ev.REGISTRY["_test_boom"]


@pytest.mark.parametrize("status", ["failed", "skipped", "error", "inconclusive"])
def test_score_none_unless_completed(status):
    r = ev._result(
        agent="a",
        case_id="t1",
        variant="clean",
        meta=ev.REGISTRY["answer_correctness"],
        status=status,
        score=0.5,
        verdict="not_applicable",
        label="x",
        explanation="y",
    )
    assert r["score"] is None


def test_rescore_tiny_mock_file(tmp_path, monkeypatch):
    out = tmp_path / "out"
    (out / "perturbed").mkdir(parents=True)
    monkeypatch.setattr(ev, "OUT", out)

    data = {
        "meta": {"agents": ["a"], "judge": "j", "conditions": ["clean"], "mock": True},
        "cases": [CASE],
        "runs": [
            _run("42.00", CASE["truth_box"], condition="clean"),
            _run("unknown", None, condition="blind"),
        ],
        "judged": [
            {
                "kind": "planted_right",
                "agent": None,
                "case_id": "t1",
                "proposed": "42.00",
                "judge_accepts": True,
                "truth_correct": True,
                "agrees": True,
            },
            {
                "kind": "planted_wrong",
                "agent": None,
                "case_id": "t1",
                "proposed": "12.00",
                "judge_accepts": False,
                "truth_correct": False,
                "agrees": True,
            },
            {
                "kind": "agent_answer",
                "agent": "a",
                "case_id": "t1",
                "proposed": "42.00",
                "judge_accepts": True,
                "truth_correct": True,
                "agrees": True,
            },
        ],
    }
    path = out / "results.json"
    path.write_text(json.dumps(data))

    loaded = json.loads(path.read_text())
    ev.enrich_results_payload(loaded, evidence_margin=25)
    ev.write_traces(loaded["traces"], traces_dir=out / "traces")
    path.write_text(json.dumps(loaded))

    assert loaded["results"]
    assert loaded["dimension_summary"]
    assert loaded["meta"]["evidence_margin"] == 25
    assert any(r["dimension"] == "Confident errors" for r in loaded["dimension_summary"])
    assert "registry" in loaded
    assert loaded["traces"]
    assert any(r["evaluator_id"] == "media_dependence" for r in loaded["results"])
    assert (out / "traces").is_dir()

    for r in loaded["runs"]:
        r.pop("prompt", None)
        r.pop("raw", None)
        r.pop("usage", None)
    traces2 = ev.build_traces(loaded["cases"], loaded["runs"], loaded["results"])
    assert traces2[0]["spans"][1]["usage"] == "(not recorded in this run)"
    assert traces2[0]["spans"][1]["output"]["raw"] == "(not recorded in this run)"
