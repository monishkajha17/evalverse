"""Tests for perception_judge, judge controls, orchestrator, and run manifest."""
from __future__ import annotations

import json

from evalverse import core
from evalverse import evaluators as ev
from evalverse.orchestrator import Orchestrator, build_manifest

CASE = {
    "id": "t1",
    "question": "What is the total?",
    "answer": "42.00",
    "answer_type": "number",
    "distractor": "12.00",
    "truth_box": [100, 200, 300, 250],
    "image": "data/images/t1.png",
}


def _run(answer, box, *, agent="a", case_id="t1", condition="clean"):
    correct = core.answer_correct(CASE, answer)
    ev_ok = core.evidence_ok(CASE["truth_box"], box)
    return {
        "agent": agent,
        "case_id": case_id,
        "condition": condition,
        "answer": answer,
        "box": box,
        "evidence": "seen",
        "correct": correct,
        "evidence_ok": ev_ok,
        "iou": 0.0,
        "label": core.attribute(correct, ev_ok, True, answer=answer, box=box),
        "latency": 0.01,
        "error": None,
        "model": agent,
        "usage": {"input_tokens": 10, "output_tokens": 2},
    }


def test_perception_judge_statuses():
    meta = ev.REGISTRY["perception_judge"]
    run = _run("42.00", CASE["truth_box"])

    skipped = ev._call(
        meta, "a", "t1", "clean", case=CASE, run=run, judged=[], judge_model="j"
    )
    assert skipped["status"] == "skipped"

    incon = ev._call(
        meta,
        "a",
        "t1",
        "clean",
        case=CASE,
        run=run,
        judged=[
            {
                "kind": "agent_answer",
                "agent": "a",
                "case_id": "t1",
                "judge_accepts": None,
                "truth_correct": True,
            }
        ],
        judge_model="muse-spark-1.3",
    )
    assert incon["status"] == "inconclusive"
    assert incon["score"] is None

    ok = ev._call(
        meta,
        "a",
        "t1",
        "clean",
        case=CASE,
        run=run,
        judged=[
            {
                "kind": "agent_answer",
                "agent": "a",
                "case_id": "t1",
                "judge_accepts": True,
                "truth_correct": True,
                "agrees": True,
            }
        ],
        judge_model="muse-spark-1.3",
    )
    assert ok["status"] == "completed"
    assert ok["score"] == 1.0
    assert ok["label"] == "judge_accepts"
    assert "muse-spark-1.3" in ok["explanation"]
    assert ok["evidence"][0]["role"] == "claimed"

    rej = ev._call(
        meta,
        "a",
        "t1",
        "blur",
        case=CASE,
        run=_run("12.00", [0, 0, 10, 10], condition="blur"),
        judged=[
            {
                "kind": "agent_answer",
                "agent": "a",
                "case_id": "t1",
                "judge_accepts": False,
                "truth_correct": False,
                "agrees": True,
            }
        ],
        judge_model="j",
    )
    assert rej["label"] == "judge_rejects"
    assert rej["score"] == 0.0


def test_judge_media_dependence():
    meta = ev.REGISTRY["judge_media_dependence"]
    judged = [
        {"kind": "planted_right", "judge_accepts": True, "truth_correct": True, "agrees": True},
        {"kind": "planted_wrong", "judge_accepts": False, "truth_correct": False, "agrees": True},
        {"kind": "planted_right_noimg", "judge_accepts": False, "truth_correct": True, "agrees": False},
        {"kind": "planted_wrong_noimg", "judge_accepts": True, "truth_correct": False, "agrees": False},
    ]
    res = ev._call(meta, "*", "*", "all", judged=judged)
    assert res["status"] == "completed"
    # with-image accuracy 1.0, without 0.0 -> score 1.0
    assert res["score"] == 1.0
    assert "accuracy_with_image" in res["explanation"]
    assert "false-accept" in res["explanation"]

    skipped = ev._call(meta, "*", "*", "all", judged=judged[:2])
    assert skipped["status"] == "skipped"


def test_select_evaluators_skips_modality_mismatch():
    selected, skipped = ev.select_evaluators_for_case(CASE)
    ids = {m["id"] for m in selected}
    assert "answer_correctness" in ids
    assert "perception_judge" in ids
    assert "transcript_fidelity" not in ids
    assert any("modality" in reason for _, reason in skipped)


def test_orchestrator_plan_and_manifest(tmp_path, monkeypatch):
    # Point perturbed output at tmp so we do not require real images for planning.
    from evalverse import orchestrator as orch_mod

    monkeypatch.setattr(orch_mod, "OUT", tmp_path / "out")
    monkeypatch.setattr(orch_mod, "PERTURBED", tmp_path / "out" / "perturbed")
    monkeypatch.setattr(orch_mod, "ROOT", tmp_path)
    monkeypatch.setattr(ev, "OUT", tmp_path / "out")
    # Tiny 1x1 png for the case image
    from PIL import Image

    img_path = tmp_path / "data" / "images" / "t1.png"
    img_path.parent.mkdir(parents=True)
    Image.new("RGB", (8, 8), (255, 255, 255)).save(img_path)
    cases_path = tmp_path / "data" / "cases.json"
    case = dict(CASE)
    case["image"] = "data/images/t1.png"
    cases_path.write_text(json.dumps([case]))

    backend = core.MockBackend(seed=1)
    orch = Orchestrator(
        cases=[case],
        agents=["muse-spark-1.3"],
        variants=["clean"],
        backend=backend,
        judge_model="muse-spark-1.3",
        config={
            "mock": True,
            "judge_controls": True,
            "dataset_path": str(cases_path.relative_to(tmp_path)),
        },
    )
    jobs = orch.plan()
    kinds = {j.kind for j in jobs}
    assert "agent" in kinds and "judge" in kinds and "judge_control" in kinds
    assert any(j.payload.get("judge_kind") == "planted_right_noimg" for j in jobs if j.kind == "judge_control")

    # prepare_images uses ROOT / case image — ROOT is tmp_path
    result = orch.execute(workers=2)
    assert "manifest" in result["meta"]
    man = result["meta"]["manifest"]
    assert man["mock"] is True
    assert man["judge_controls"] is True
    assert "agent_prompt_sha256" in man and len(man["agent_prompt_sha256"]) == 64
    assert "judge_prompt_sha256" in man
    assert "total_calls" in man and man["total_calls"] > 0
    assert "token_totals" in man
    assert result["plan"]
    assert all("status" in j for j in result["plan"])
    assert "conflicts" in result
    assert any(j["kind"] == "planted_right_noimg" for j in result["judged"])
    assert any(j["kind"] == "planted_wrong_noimg" for j in result["judged"])
    assert any(r["evaluator_id"] == "judge_media_dependence" for r in result["results"])
    assert any(r["evaluator_id"] == "perception_judge" for r in result["results"])


def test_rescore_preserves_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(ev, "OUT", tmp_path / "out")
    (tmp_path / "out" / "perturbed").mkdir(parents=True)
    manifest = build_manifest(
        dataset_path="data/cases.json",
        agents=["a"],
        judge_model="j",
        variants=["clean"],
        mock=True,
        total_calls=3,
        token_totals={"input_tokens": 1, "output_tokens": 1, "reasoning_tokens": 0},
        judge_controls=True,
    )
    data = {
        "meta": {"agents": ["a"], "judge": "j", "conditions": ["clean"], "mock": True, "manifest": manifest},
        "cases": [CASE],
        "runs": [_run("42.00", CASE["truth_box"]), _run("unknown", None, condition="blind")],
        "judged": [
            {
                "kind": "agent_answer",
                "agent": "a",
                "case_id": "t1",
                "judge_accepts": True,
                "truth_correct": True,
                "agrees": True,
            },
            {
                "kind": "planted_right",
                "judge_accepts": True,
                "truth_correct": True,
                "agrees": True,
            },
            {
                "kind": "planted_wrong",
                "judge_accepts": False,
                "truth_correct": False,
                "agrees": True,
            },
        ],
        "plan": [{"id": "agent|a|t1|clean", "status": "completed"}],
    }
    ev.enrich_results_payload(data, evidence_margin=25)
    assert data["meta"]["manifest"] == manifest
    assert data["plan"][0]["id"] == "agent|a|t1|clean"
    assert "conflicts" in data


def test_judge_prompt_no_media_has_no_missing_hint():
    assert "missing" not in core.JUDGE_PROMPT_NO_MEDIA.lower()
    assert "image" not in core.JUDGE_PROMPT_NO_MEDIA.lower()
    assert "{question}" in core.JUDGE_PROMPT_NO_MEDIA
    assert "{proposed}" in core.JUDGE_PROMPT_NO_MEDIA
