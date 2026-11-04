"""Cross-modal consistency tests — no live model calls."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from evalverse import core
from evalverse import crossmodal_run
from evalverse import evaluators as ev
from evalverse.datasets import crossmodal as cm_ds


CASE = {
    "id": "cm_01",
    "modality": "cross_modal",
    "family": "receipt_vs_claim",
    "claim_channel": "voice",
    "claim_value": 148127.0,
    "receipt_value": "148,127",
    "expected_verdict": "consistent",
    "truth_box": [100, 800, 900, 950],
    "claim_text": "The total on my receipt is 148,127 rupiah.",
    "duration_ms": 1200,
}


def _run(
    *,
    verdict="consistent",
    claimed="148127",
    image="148,127",
    box=None,
    channel="voice",
    expected="consistent",
    error=None,
    label=None,
):
    case = dict(CASE)
    case["expected_verdict"] = expected
    case["claim_channel"] = channel
    r = {
        "verdict": verdict,
        "answer": verdict,
        "claimed_value": claimed,
        "image_value": image,
        "image_box": box if box is not None else list(CASE["truth_box"]),
        "box": box if box is not None else list(CASE["truth_box"]),
        "channel": channel,
        "error": error,
        "label": label,
    }
    return case, r


def test_words_to_number():
    assert core.words_to_number(
        "one hundred forty-eight thousand one hundred twenty-seven"
    ) == 148127
    assert core.words_to_number("twenty-one") == 21
    assert core.words_to_number("three thousand") == 3000
    assert core.words_to_number("not a number") is None
    assert core.parse_amount("one hundred") == 100.0
    assert core.parse_amount("148,127") == 148127.0


def test_consistency_labels():
    case, run = _run(verdict="consistent", expected="consistent")
    assert ev.cross_modal_consistency_label(case, run) == "correct_verdict"

    case, run = _run(verdict="consistent", expected="inconsistent")
    assert ev.cross_modal_consistency_label(case, run) == "missed_contradiction"

    case, run = _run(verdict="inconsistent", expected="consistent")
    assert ev.cross_modal_consistency_label(case, run) == "false_alarm"

    case, run = _run(verdict="cannot_tell", expected="consistent")
    assert ev.cross_modal_consistency_label(case, run) == "abstained"

    case, run = _run(verdict="maybe", expected="consistent")
    assert ev.cross_modal_consistency_label(case, run) == "invalid_output"

    case, run = _run(verdict="consistent", expected="consistent", error="boom")
    assert ev.cross_modal_consistency_label(case, run) == "invalid_output"


def test_perception_and_stage_labels():
    case, run = _run(claimed="148127", image="148,127", channel="voice")
    assert ev.cross_modal_perception_label(case, run) == "both_read"
    assert ev.cross_modal_stage_label(case, run) == "cross_modal_correct"

    case, run = _run(claimed="999", image="148,127", channel="voice")
    assert ev.cross_modal_perception_label(case, run) == "heard_wrong"
    assert ev.cross_modal_stage_label(case, run) == "heard_wrong"

    case, run = _run(claimed="148127", image="12", channel="voice")
    assert ev.cross_modal_perception_label(case, run) == "misread_image"
    assert ev.cross_modal_stage_label(case, run) == "misread_image"

    case, run = _run(claimed="1", image="2", channel="voice")
    assert ev.cross_modal_perception_label(case, run) == "both_wrong"

    # Both values right, verdict wrong -> comparison_error
    case, run = _run(
        verdict="inconsistent",
        expected="consistent",
        claimed="148127",
        image="148,127",
        channel="voice",
    )
    assert ev.cross_modal_stage_label(case, run) == "comparison_error"

    # Text channel scores image only
    case, run = _run(claimed="wrong", image="148,127", channel="text")
    assert ev.cross_modal_perception_label(case, run) == "both_read"
    meta = ev.REGISTRY["cross_modal_perception"]
    res = ev._call(meta, "a", "cm_01", "clean", case=case, run=run)
    assert res["score"] == 1.0


def test_no_image_prompt_forbids_cannot_tell():
    prompt = core.cross_modal_prompt("Q?", "The total is 1 rupiah.", "no_image")
    assert "cannot_tell is not allowed" in prompt
    assert "single best guess" in prompt
    clean = core.cross_modal_prompt("Q?", "claim", "clean")
    assert "cannot_tell is not allowed" not in clean


def test_dag_two_roots_join():
    case = {
        "id": "cm_01",
        "modality": "cross_modal",
        "claim_channel": "voice",
        "image": "data/x.jpg",
        "audio": "data/x.wav",
        "duration_ms": 1000,
        "claim_text": "hi",
    }
    run = {
        "agent": "a",
        "case_id": "cm_01",
        "condition": "clean",
        "channel": "voice",
        "transcript": "hi",
        "wer": 0.0,
        "prompt": "p",
        "raw": "{}",
        "verdict": "consistent",
    }
    tr = crossmodal_run.build_crossmodal_trace(case, run, ["r1"])
    by = {s["id"]: s for s in tr["spans"]}
    assert by["s1"]["name"] == "attach receipt image"
    assert by["s1"]["parent_span_ids"] == []
    assert by["s2"]["name"] == "attach voice clip"
    assert by["s2"]["parent_span_ids"] == []
    assert by["s3"]["name"] == "transcribe voice"
    assert by["s3"]["parent_span_ids"] == ["s2"]
    assert set(by["s4"]["parent_span_ids"]) == {"s1", "s3"}
    assert by["s5"]["parent_span_ids"] == ["s4"]
    assert ev.dag_is_acyclic(tr["spans"])

    # Text channel: image root only
    case_t = dict(case, claim_channel="text", audio=None)
    run_t = dict(run, channel="text")
    tr_t = crossmodal_run.build_crossmodal_trace(case_t, run_t, [])
    by_t = {s["id"]: s for s in tr_t["spans"]}
    assert "s2" not in by_t and "s3" not in by_t
    assert by_t["s4"]["parent_span_ids"] == ["s1"]


def test_balanced_classes(tmp_path, monkeypatch):
    # Build from real CORD cases if present; otherwise skip.
    if not (Path("data/cases_cord.json")).is_file():
        pytest.skip("cases_cord.json missing")
    monkeypatch.setattr(cm_ds, "OUT_CASES", tmp_path / "cases_crossmodal.json")
    monkeypatch.setattr(cm_ds, "AUDIO_DIR", tmp_path / "audio_cm")
    # Prefer sine fallback so CI without say still exercises voice share when forced.
    cases = cm_ds.build_cases(n=30, seed=7, voice_share=0.67, force_sine_voice=True, verbose=False)
    assert len(cases) == 30
    n_c = sum(1 for c in cases if c["expected_verdict"] == "consistent")
    n_i = sum(1 for c in cases if c["expected_verdict"] == "inconsistent")
    assert n_c == 15 and n_i == 15
    for c in cases:
        assert c["modality"] == "cross_modal"
        assert "148" not in c["question"]  # no amount leak from common cord totals is soft; check fields
        assert core._amount(c["claim_value"]) is not None
        assert core._amount(c["receipt_value"]) is not None
        if c["expected_verdict"] == "inconsistent":
            assert abs(core._amount(c["claim_value"]) - core._amount(c["receipt_value"])) >= 0.0051


def test_mock_e2e(tmp_path, monkeypatch):
    monkeypatch.setattr(crossmodal_run, "OUT", tmp_path)
    monkeypatch.setattr(crossmodal_run, "CASES_PATH", tmp_path / "missing.json")
    monkeypatch.setattr(
        "sys.argv",
        ["crossmodal_run", "--mock", "--tag", "crossmodal", "--agents", "muse-spark-1.3", "--limit", "2"],
    )
    crossmodal_run.main()
    payload = json.loads((tmp_path / "results_crossmodal.json").read_text())
    assert payload["meta"]["modality"] == "cross_modal"
    assert payload["runs"]
    assert payload["traces"]
    # Voice mock cases: DAG has two roots joining
    voice_tr = next(t for t in payload["traces"] if t.get("variant") == "clean")
    by = {s["id"]: s for s in voice_tr["spans"]}
    assert set(by["s4"]["parent_span_ids"]) == {"s1", "s3"}
    eids = {r["evaluator_id"] for r in payload["results"]}
    assert "cross_modal_consistency" in eids
    assert "cross_modal_perception" in eids
    assert "cross_modal_stage_attribution" in eids
    assert "cross_modal_media_dependence" in eids
    assert "evidence_grounding" in eids
    assert "judge_audit" in eids
    assert "robustness_sweep" in eids
    # Stage label examples appear somewhere in results
    labels = {r.get("label") for r in payload["results"]}
    assert "cross_modal_correct" in labels or "correct_verdict" in labels


def test_media_dependence_chance_and_inconclusive():
    meta = ev.REGISTRY["cross_modal_media_dependence"]
    case, clean = _run(verdict="consistent", expected="consistent")
    _, noimg_wrong = _run(verdict="inconsistent", expected="consistent")
    _, noimg_right = _run(verdict="consistent", expected="consistent")
    _, clean_wrong = _run(verdict="inconsistent", expected="consistent")

    ok = ev._call(
        meta,
        "a",
        "cm_01",
        "all",
        case=case,
        clean_run=clean,
        sibling_runs={"no_image": noimg_wrong},
    )
    assert ok["label"] == "media_required" and "50%" in ok["explanation"]

    bad = ev._call(
        meta,
        "a",
        "cm_01",
        "all",
        case=case,
        clean_run=clean,
        sibling_runs={"no_image": noimg_right},
    )
    assert bad["label"] == "media_not_required"

    incon = ev._call(
        meta,
        "a",
        "cm_01",
        "all",
        case=case,
        clean_run=clean_wrong,
        sibling_runs={"no_image": noimg_wrong},
    )
    assert incon["status"] == "inconclusive"
