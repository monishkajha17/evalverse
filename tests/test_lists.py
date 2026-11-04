"""Tests for menu_list / unanswerable CORD families and list evaluators."""
from __future__ import annotations

import json

from evalverse import core
from evalverse import evaluators as ev
from evalverse.datasets import cord as cord_mod

MENU_CASE = {
    "id": "m1",
    "family": "menu_list",
    "question": cord_mod.MENU_LIST_QUESTION,
    "answer": json.dumps({"items": [{"name": "Kopi", "price": "12.000"}, {"name": "Teh", "price": "8.000"}]}),
    "answer_type": "menu_list",
    "distractor": json.dumps({"items": [{"name": "Kopi", "price": "12.000"}]}),
    "truth_box": [100, 200, 800, 600],
    "menu": [{"name": "Kopi", "price": "12.000"}, {"name": "Teh", "price": "8.000"}],
    "image": "data/images_cord/x.jpg",
}

UNANS_CASE = {
    "id": "u1",
    "family": "unanswerable",
    "question": 'What is the change on this receipt? Answer with the number only, or "not shown" if the receipt does not print it.',
    "answer": "not shown",
    "answer_type": "unanswerable",
    "distractor": "5.000",
    "truth_box": None,
    "unanswerable_field": "changeprice",
    "image": "data/images_cord/x.jpg",
}


def _run(case, answer, box=None, condition="clean", agent="a"):
    correct = core.answer_correct(case, answer)
    return {
        "agent": agent,
        "case_id": case["id"],
        "condition": condition,
        "answer": answer,
        "box": box,
        "evidence": "mock",
        "correct": correct,
        "evidence_ok": False,
        "iou": 0.0,
        "label": "x",
        "error": None,
    }


def test_match_menu_items_greedy():
    true = [{"name": "ICE TEA", "price": "10,000"}, {"name": "NASI GORENG", "price": "25.000"}]
    pred = [
        {"name": "ice tea", "price": "10000"},
        {"name": "FAB FOOD", "price": "1"},
        {"name": "nasi goreng", "price": "25000"},
    ]
    matched, missing, fabricated = core.match_menu_items(pred, true)
    assert len(matched) == 2
    assert missing == []
    assert len(fabricated) == 1
    assert fabricated[0]["name"] == "FAB FOOD"


def test_item_recall_complete_and_missing():
    meta = ev.REGISTRY["item_recall"]
    full = json.dumps({"items": MENU_CASE["menu"]})
    res = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, full, MENU_CASE["truth_box"]))
    assert res["status"] == "completed"
    assert res["score"] == 1.0
    assert res["label"] == "complete"
    assert res["dimension"] == "Completeness"

    partial = json.dumps({"items": [MENU_CASE["menu"][0]]})
    res2 = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, partial, MENU_CASE["truth_box"]))
    assert res2["label"] == "missing_items"
    assert res2["score"] == 0.5
    assert "Teh" in res2["explanation"]


def test_fabrication_check_menu_and_unanswerable():
    meta = ev.REGISTRY["fabrication_check"]
    clean = json.dumps({"items": MENU_CASE["menu"]})
    ok = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, clean))
    assert ok["label"] == "no_fabrication"
    assert ok["score"] == 1.0
    assert ok["dimension"] == "Hallucination"

    fab = json.dumps({"items": MENU_CASE["menu"] + [{"name": "X", "price": "1"}]})
    bad = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, fab))
    assert bad["label"] == "fabricated_items:1"
    assert abs(bad["score"] - (2 / 3)) < 1e-9

    abstain = ev._call(
        meta, "a", "u1", "clean", case=UNANS_CASE, run=_run(UNANS_CASE, "not shown")
    )
    assert abstain["label"] == "correctly_abstained"
    assert abstain["score"] == 1.0

    invented = ev._call(meta, "a", "u1", "clean", case=UNANS_CASE, run=_run(UNANS_CASE, "12.50"))
    assert invented["label"] == "fabricated_answer"
    assert invented["score"] == 0.0


def test_evidence_grounding_unanswerable_skipped():
    meta = ev.REGISTRY["evidence_grounding"]
    res = ev._call(
        meta, "a", "u1", "clean", case=UNANS_CASE, run=_run(UNANS_CASE, "not shown"), evidence_margin=25
    )
    assert res["status"] == "skipped"
    assert "no region expected" in res["explanation"]


def test_stage_attribution_list_labels():
    meta = ev.REGISTRY["stage_attribution"]
    full = json.dumps({"items": MENU_CASE["menu"]})
    r = ev._call(
        meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, full, MENU_CASE["truth_box"])
    )
    assert r["label"] == "complete_correct"

    partial = json.dumps({"items": [MENU_CASE["menu"][0]]})
    r2 = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, partial))
    assert r2["label"] == "incomplete"

    fab = json.dumps({"items": [{"name": "X", "price": "1"}]})
    r3 = ev._call(meta, "a", "m1", "clean", case=MENU_CASE, run=_run(MENU_CASE, fab))
    assert r3["label"] == "fabricated"

    r4 = ev._call(meta, "a", "u1", "clean", case=UNANS_CASE, run=_run(UNANS_CASE, "not shown"))
    assert r4["label"] == "abstained_correctly"


def test_cord_helpers_menu_and_absent():
    parse = {
        "menu": [{"nm": "A", "price": "1.000"}, {"nm": "B", "price": "2.000"}],
        "total": {"total_price": "3.000"},
    }
    items = cord_mod._menu_items(parse)
    assert len(items) == 2
    lines = [{"category": "menu.nm"}, {"category": "total.total_price"}]
    absent = cord_mod._absent_fields(parse, lines)
    keys = {k for k, _ in absent}
    assert "changeprice" in keys
    assert "service_price" in keys
    # discount present in parse should not be absent
    parse2 = {"sub_total": {"discount_price": "100"}, "menu": {"nm": "A", "price": "1"}}
    absent2 = cord_mod._absent_fields(parse2, [])
    assert "discount_price" not in {k for k, _ in absent2}


def test_evaluate_all_dimension_summary_has_completeness(tmp_path):
    runs = [
        _run(MENU_CASE, json.dumps({"items": MENU_CASE["menu"]}), MENU_CASE["truth_box"]),
        _run(UNANS_CASE, "not shown"),
    ]
    # blind siblings so media_dependence can resolve
    runs += [
        _run(MENU_CASE, "unknown", None, condition="blind"),
        _run(UNANS_CASE, "unknown", None, condition="blind"),
    ]
    results, summary, disagreements, conflicts = ev.evaluate_all(
        [MENU_CASE, UNANS_CASE], runs, [], ["a"], evidence_margin=0
    )
    dims = {row["dimension"] for row in summary}
    assert "Completeness" in dims
    assert "Hallucination" in dims
    assert any(r["evaluator_id"] == "item_recall" and r["status"] == "completed" for r in results)
    assert any(
        r["evaluator_id"] == "fabrication_check" and r["label"] == "correctly_abstained" for r in results
    )
